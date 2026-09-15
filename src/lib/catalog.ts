export type SourceType = "shopify" | "sitemap" | "html";
export type SourceOrder = "oldest-first" | "newest-first" | "unknown";

export type CatalogProduct = {
  externalId: string;
  title: string;
  productUrl: string;
  imageUrl: string | null;
  publishedAt: Date | null;
  sourceIndex: number;
  inStock: boolean | null;
};

export type CatalogResult = {
  sourceType: SourceType;
  sourceOrder: SourceOrder;
  shopName: string;
  products: CatalogProduct[];
};

const UA =
  "ClothDropTracker/1.0 (+https://localhost; personal catalog watcher)";

const DEFAULT_BUDGET_MS = 120_000;

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

function boundedTimeout(deadline: number, max = 15000): number {
  return Math.max(0, Math.min(max, deadline - Date.now()));
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
  timeoutMs = 15000,
): Promise<{ ok: boolean; status: number; text: string; finalUrl: string }> {
  const res = await fetchResponse(url, timeoutMs);
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
  published_at?: string | null;
  created_at?: string | null;
  variants?: { available?: boolean }[];
};

async function fetchShopifyPage(
  origin: string,
  page: number,
  deadline: number,
): Promise<ShopifyProduct[] | null> {
  const timeoutMs = boundedTimeout(deadline);
  if (timeoutMs <= 0) return null;
  const url = `${origin}/products.json?limit=250&page=${page}`;
  const { ok, text } = await fetchText(url, timeoutMs);
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
  deadline: number,
): Promise<{ products: CatalogProduct[]; complete: boolean } | null> {
  const first = await fetchShopifyPage(origin, 1, deadline);
  if (!first) return null;

  const all = [...first];
  let complete = true;
  for (let page = 2; page <= 20 && first.length === 250; page += 1) {
    if (Date.now() >= deadline) {
      complete = false;
      break;
    }
    const next = await fetchShopifyPage(origin, page, deadline);
    if (!next || next.length === 0) break;
    all.push(...next);
    if (next.length < 250) break;
  }

  const products = all
    .map((product, index) => {
      const handle = product.handle ?? String(product.id);
      const variants = product.variants;
      return {
        externalId: String(product.id),
        title: product.title?.trim() || titleFromHandle(handle),
        productUrl: `${origin}/products/${handle}`,
        imageUrl: httpsImage(product.images?.[0]?.src ?? product.featured_image),
        publishedAt: parseDate(product.published_at ?? product.created_at),
        sourceIndex: index,
        inStock:
          Array.isArray(variants) && variants.length > 0
            ? variants.some((v) => v.available === true)
            : null,
      };
    })
    .filter((p) => p.externalId);

  return { products, complete };
}

type LocEntry = { loc: string; lastmod: Date | null };

function extractUrlEntries(xml: string): LocEntry[] {
  const entries: LocEntry[] = [];
  const blockRe = /<(?:url|sitemap)\b[^>]*>([\s\S]*?)<\/(?:url|sitemap)>/gi;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(xml))) {
    const block = blockMatch[1];
    // Deliberately matches only a bare <loc>, not <image:loc> or similar
    // namespaced elements, since those never contain a product URL.
    const locMatch = block.match(/<loc>\s*([^<]+)\s*<\/loc>/i);
    if (!locMatch) continue;
    const lastmodMatch = block.match(/<lastmod>\s*([^<]+)\s*<\/lastmod>/i);
    entries.push({
      loc: decodeEntities(locMatch[1].trim()),
      lastmod: lastmodMatch
        ? parseDate(decodeEntities(lastmodMatch[1].trim()))
        : null,
    });
  }
  return entries;
}

async function fetchSitemapCatalog(
  origin: string,
  deadline: number,
): Promise<CatalogProduct[] | null> {
  const candidates = [
    `${origin}/sitemap_products_1.xml`,
    `${origin}/sitemap.xml`,
  ];

  // lastmod reflects the last MODIFICATION to a sitemap entry, not when the
  // product was first published — treated as a best-effort recency signal,
  // ranked below an explicit publishedAt from other sources.
  const productUrls = new Map<string, Date | null>();

  for (const sitemapUrl of candidates) {
    const timeoutMs = boundedTimeout(deadline);
    if (timeoutMs <= 0) break;
    const { ok, text } = await fetchText(sitemapUrl, timeoutMs);
    if (!ok) continue;
    const entries = extractUrlEntries(text);
    const nested = entries.filter(
      (e) => /sitemap/i.test(e.loc) && e.loc.endsWith(".xml"),
    );
    const products = entries.filter((e) => /\/products\//i.test(e.loc));
    for (const entry of products) {
      const key = entry.loc.split("?")[0];
      if (!productUrls.has(key)) productUrls.set(key, entry.lastmod);
    }

    for (const child of nested.slice(0, 8)) {
      if (Date.now() >= deadline) break;
      if (!/product/i.test(child.loc) && nested.length > 1) continue;
      const childTimeout = boundedTimeout(deadline);
      if (childTimeout <= 0) break;
      const childRes = await fetchText(child.loc, childTimeout);
      if (!childRes.ok) continue;
      for (const entry of extractUrlEntries(childRes.text)) {
        if (/\/products\//i.test(entry.loc)) {
          const key = entry.loc.split("?")[0];
          if (!productUrls.has(key)) productUrls.set(key, entry.lastmod);
        }
      }
    }

    if (productUrls.size > 0) break;
  }

  if (productUrls.size === 0) return null;

  return [...productUrls.entries()].map(([productUrl, lastmod], index) => {
    const handle = productHandleFromUrl(productUrl) ?? productUrl;
    return {
      externalId: handle,
      title: titleFromHandle(handle),
      productUrl,
      imageUrl: null,
      publishedAt: lastmod,
      sourceIndex: index,
      inStock: null,
    };
  });
}

function fetchHtmlCatalog(pageUrl: string, html: string): CatalogProduct[] {
  const seen = new Map<string, CatalogProduct>();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  let index = 0;

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
      publishedAt: null,
      sourceIndex: index,
      inStock: null,
    });
    index += 1;
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

export type ProbeCatalogOptions = {
  budgetMs?: number;
};

export async function probeCatalog(
  rawUrl: string,
  opts: ProbeCatalogOptions = {},
): Promise<{
  origin: string;
  host: string;
  pageUrl: string;
  complete: boolean;
  result: CatalogResult;
}> {
  const deadline = Date.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const url = normalizeShopUrl(rawUrl);
  const origin = url.origin;
  const host = url.hostname.toLowerCase();
  const pageUrl = url.toString();

  let shopName = host.replace(/^www\./, "");
  try {
    const homeTimeout = boundedTimeout(deadline);
    if (homeTimeout > 0) {
      const home = await fetchText(origin, homeTimeout);
      if (home.ok) shopName = shopNameFromHtml(home.text, host);
    }
  } catch {
    // keep hostname
  }

  const shopify = await fetchShopifyCatalog(origin, deadline);
  if (shopify && shopify.products.length > 0) {
    return {
      origin,
      host,
      pageUrl,
      complete: shopify.complete,
      result: {
        sourceType: "shopify",
        sourceOrder: "oldest-first",
        shopName,
        products: shopify.products,
      },
    };
  }

  const sitemap = await fetchSitemapCatalog(origin, deadline);
  if (sitemap && sitemap.length > 0) {
    return {
      origin,
      host,
      pageUrl,
      complete: true,
      result: {
        sourceType: "sitemap",
        sourceOrder: "oldest-first",
        shopName,
        products: sitemap,
      },
    };
  }

  const pageTimeout = boundedTimeout(deadline);
  if (pageTimeout > 0) {
    const page = await fetchText(pageUrl, pageTimeout);
    if (page.ok) {
      const htmlProducts = fetchHtmlCatalog(page.finalUrl || pageUrl, page.text);
      if (htmlProducts.length > 0) {
        return {
          origin,
          host,
          pageUrl,
          complete: true,
          result: {
            sourceType: "html",
            sourceOrder: "newest-first",
            shopName,
            products: htmlProducts,
          },
        };
      }
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
