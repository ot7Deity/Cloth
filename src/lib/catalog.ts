export type SourceType = "shopify" | "sitemap" | "html";

export type CatalogProduct = {
  externalId: string;
  title: string;
  productUrl: string;
  imageUrl: string | null;
};

export type CatalogResult = {
  sourceType: SourceType;
  shopName: string;
  products: CatalogProduct[];
};

const UA =
  "ClothDropTracker/1.0 (+https://localhost; personal catalog watcher)";

function absoluteUrl(from: string, href: string): string | null {
  try {
    return new URL(href, from).toString();
  } catch {
    return null;
  }
}

export function normalizeShopUrl(raw: string): URL {
  const trimmed = raw.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (!url.hostname) {
    throw new Error("Invalid URL");
  }
  return url;
}

async function fetchResponse(
  url: string,
  timeoutMs = 15000,
): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": UA, Accept: "*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
}

async function fetchText(
  url: string,
): Promise<{ ok: boolean; status: number; text: string; finalUrl: string }> {
  const res = await fetchResponse(url);
  const text = await res.text();
  return { ok: res.ok, status: res.status, text, finalUrl: res.url };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function titleFromHandle(handle: string): string {
  return decodeURIComponent(handle)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function httpsImage(src: string | undefined | null): string | null {
  if (!src) return null;
  if (src.startsWith("//")) return `https:${src}`;
  return src;
}

function productHandleFromUrl(productUrl: string): string | null {
  try {
    const path = new URL(productUrl).pathname;
    const match = path.match(/\/products\/([^/]+)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

type ShopifyProduct = {
  id: number | string;
  title?: string;
  handle?: string;
  featured_image?: string;
  images?: { src?: string }[];
};

async function fetchShopifyPage(
  origin: string,
  page: number,
): Promise<ShopifyProduct[] | null> {
  const url = `${origin}/products.json?limit=250&page=${page}`;
  const { ok, text } = await fetchText(url);
  if (!ok) return null;
  try {
    const data = JSON.parse(text) as { products?: ShopifyProduct[] };
    if (!Array.isArray(data.products)) return null;
    return data.products;
  } catch {
    return null;
  }
}

async function fetchShopifyCatalog(
  origin: string,
): Promise<CatalogProduct[] | null> {
  const first = await fetchShopifyPage(origin, 1);
  if (!first) return null;

  const all = [...first];
  for (let page = 2; page <= 20 && first.length === 250; page += 1) {
    const next = await fetchShopifyPage(origin, page);
    if (!next || next.length === 0) break;
    all.push(...next);
    if (next.length < 250) break;
  }

  return all
    .map((product) => {
      const handle = product.handle ?? String(product.id);
      return {
        externalId: String(product.id),
        title: product.title?.trim() || titleFromHandle(handle),
        productUrl: `${origin}/products/${handle}`,
        imageUrl: httpsImage(product.images?.[0]?.src ?? product.featured_image),
      };
    })
    .filter((p) => p.externalId);
}

function extractLocs(xml: string): string[] {
  const locs: string[] = [];
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml))) {
    locs.push(decodeEntities(match[1].trim()));
  }
  return locs;
}

async function fetchSitemapCatalog(
  origin: string,
): Promise<CatalogProduct[] | null> {
  const candidates = [
    `${origin}/sitemap_products_1.xml`,
    `${origin}/sitemap.xml`,
  ];

  const productUrls = new Set<string>();

  for (const sitemapUrl of candidates) {
    const { ok, text } = await fetchText(sitemapUrl);
    if (!ok) continue;
    const locs = extractLocs(text);
    const nested = locs.filter((loc) => /sitemap/i.test(loc) && loc.endsWith(".xml"));
    const products = locs.filter((loc) => /\/products\//i.test(loc));
    for (const loc of products) productUrls.add(loc.split("?")[0]);

    for (const child of nested.slice(0, 8)) {
      if (!/product/i.test(child) && nested.length > 1) continue;
      const childRes = await fetchText(child);
      if (!childRes.ok) continue;
      for (const loc of extractLocs(childRes.text)) {
        if (/\/products\//i.test(loc)) productUrls.add(loc.split("?")[0]);
      }
    }

    if (productUrls.size > 0) break;
  }

  if (productUrls.size === 0) return null;

  return [...productUrls].map((productUrl) => {
    const handle = productHandleFromUrl(productUrl) ?? productUrl;
    return {
      externalId: handle,
      title: titleFromHandle(handle),
      productUrl,
      imageUrl: null,
    };
  });
}

function fetchHtmlCatalog(pageUrl: string, html: string): CatalogProduct[] {
  const seen = new Map<string, CatalogProduct>();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html))) {
    const abs = absoluteUrl(pageUrl, decodeEntities(match[1]));
    if (!abs) continue;
    let parsed: URL;
    try {
      parsed = new URL(abs);
    } catch {
      continue;
    }
    if (!/\/products\/[^/]+/i.test(parsed.pathname)) continue;
    parsed.hash = "";
    parsed.search = "";
    const productUrl = parsed.toString();
    const handle = productHandleFromUrl(productUrl);
    if (!handle || handle === "products") continue;
    if (seen.has(handle)) continue;
    seen.set(handle, {
      externalId: handle,
      title: titleFromHandle(handle),
      productUrl,
      imageUrl: null,
    });
  }

  return [...seen.values()];
}

function shopNameFromHtml(html: string, host: string): string {
  const og = html.match(
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
  );
  if (og?.[1]) return decodeEntities(og[1]).trim();
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (title?.[1]) {
    const cleaned = decodeEntities(title[1])
      .split("|")[0]
      .split("–")[0]
      .split("-")[0]
      .trim();
    if (cleaned) return cleaned;
  }
  return host.replace(/^www\./, "");
}

export async function probeCatalog(rawUrl: string): Promise<{
  origin: string;
  host: string;
  pageUrl: string;
  result: CatalogResult;
}> {
  const url = normalizeShopUrl(rawUrl);
  const origin = url.origin;
  const host = url.hostname.toLowerCase();
  const pageUrl = url.toString();

  let shopName = host.replace(/^www\./, "");
  try {
    const home = await fetchText(origin);
    if (home.ok) shopName = shopNameFromHtml(home.text, host);
  } catch {
    // keep hostname
  }

  const shopify = await fetchShopifyCatalog(origin);
  if (shopify && shopify.length > 0) {
    return {
      origin,
      host,
      pageUrl,
      result: { sourceType: "shopify", shopName, products: shopify },
    };
  }

  const sitemap = await fetchSitemapCatalog(origin);
  if (sitemap && sitemap.length > 0) {
    return {
      origin,
      host,
      pageUrl,
      result: { sourceType: "sitemap", shopName, products: sitemap },
    };
  }

  const page = await fetchText(pageUrl);
  if (page.ok) {
    const htmlProducts = fetchHtmlCatalog(page.finalUrl || pageUrl, page.text);
    if (htmlProducts.length > 0) {
      return {
        origin,
        host,
        pageUrl,
        result: { sourceType: "html", shopName, products: htmlProducts },
      };
    }
  }

  throw new Error(
    "Could not find a product catalog on this site. Try a shop or collection page URL.",
  );
}

export async function refreshCatalog(input: {
  url: string;
  sourceType: SourceType;
}): Promise<CatalogResult> {
  const probed = await probeCatalog(input.url);
  return probed.result;
}
