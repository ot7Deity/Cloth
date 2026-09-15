import type { CatalogProduct, SourceOrder, SourceType } from "@/lib/catalog";
import { rankRecent } from "@/lib/rank";

const UA =
  "ClothDropTracker/1.0 (+https://localhost; personal catalog watcher)";

export type AvailabilityCheck = {
  inStock: boolean | null;
  title?: string;
  imageUrl?: string | null;
};

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function metaContent(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const match = html.match(re);
  return match?.[1] ? decodeEntities(match[1]).trim() : null;
}

function availabilityFromHtml(html: string): boolean | null {
  const schemaMatch = html.match(
    /"availability"\s*:\s*"[^"]*schema\.org\/([A-Za-z]+)"/i,
  );
  if (schemaMatch?.[1]) {
    const value = schemaMatch[1].toLowerCase();
    if (value === "instock" || value === "limitedavailability" || value === "presale") {
      return true;
    }
    if (value === "outofstock" || value === "soldout" || value === "discontinued") {
      return false;
    }
  }
  if (/sold\s*out|out of stock/i.test(html)) return false;
  if (/in\s*stock|add to (cart|bag)/i.test(html)) return true;
  return null;
}

async function checkShopifyAvailability(
  productUrl: string,
  signal: AbortSignal,
): Promise<AvailabilityCheck> {
  try {
    const res = await fetch(`${productUrl}.json`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal,
      cache: "no-store",
    });
    if (!res.ok) return { inStock: null };
    const data = (await res.json()) as {
      product?: { variants?: { available?: boolean }[]; title?: string; image?: { src?: string } };
    };
    const variants = data.product?.variants;
    return {
      inStock: Array.isArray(variants) && variants.length > 0
        ? variants.some((v) => v.available === true)
        : null,
      title: data.product?.title,
      imageUrl: data.product?.image?.src ?? undefined,
    };
  } catch {
    return { inStock: null };
  }
}

async function checkHtmlAvailability(
  productUrl: string,
  signal: AbortSignal,
): Promise<AvailabilityCheck> {
  try {
    const res = await fetch(productUrl, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal,
      cache: "no-store",
    });
    if (!res.ok) return { inStock: null };
    const html = await res.text();
    return {
      inStock: availabilityFromHtml(html),
      title: metaContent(html, "og:title") ?? undefined,
      imageUrl: metaContent(html, "og:image") ?? undefined,
    };
  } catch {
    return { inStock: null };
  }
}

export async function checkAvailability(
  productUrl: string,
  sourceType: SourceType,
  signal: AbortSignal,
): Promise<AvailabilityCheck> {
  if (sourceType === "shopify") {
    return checkShopifyAvailability(productUrl, signal);
  }
  return checkHtmlAvailability(productUrl, signal);
}

export type PreviewCandidate = {
  product: CatalogProduct;
  inStock: boolean | null;
  title?: string;
  imageUrl?: string | null;
};

export type PickPreviewCandidatesOptions = {
  sourceType: SourceType;
  sourceOrder: SourceOrder;
  want?: number;
  candidates?: number;
  budgetMs?: number;
};

export async function pickPreviewCandidates(
  products: CatalogProduct[],
  opts: PickPreviewCandidatesOptions,
): Promise<PreviewCandidate[]> {
  const want = opts.want ?? 5;
  const candidateCount = opts.candidates ?? 10;
  const budgetMs = opts.budgetMs ?? 20_000;

  const ranked = rankRecent(products, opts.sourceOrder);
  if (ranked.length === 0) return [];

  const candidates = ranked.slice(0, candidateCount);

  const controller = new AbortController();
  const budgetTimer = setTimeout(() => controller.abort(), budgetMs);

  let checked: PreviewCandidate[];
  try {
    checked = await Promise.all(
      candidates.map(async (product): Promise<PreviewCandidate> => {
        // Shopify already told us availability in the catalog response; only
        // fetch the per-product page when we don't already know.
        if (product.inStock !== null) {
          return { product, inStock: product.inStock };
        }
        try {
          const perRequest = AbortSignal.timeout(8000);
          const signal =
            typeof AbortSignal.any === "function"
              ? AbortSignal.any([perRequest, controller.signal])
              : perRequest;
          const check = await checkAvailability(product.productUrl, opts.sourceType, signal);
          return { product, ...check };
        } catch {
          return { product, inStock: null };
        }
      }),
    );
  } finally {
    clearTimeout(budgetTimer);
  }

  const inStockOrUnknown = checked.filter((c) => c.inStock !== false);

  // If checking the candidates left us short (several sold out), top up from
  // the next-ranked products without an extra fetch: unchecked means
  // indeterminate, and indeterminate is includable per decision C.
  if (inStockOrUnknown.length < want) {
    const usedIds = new Set(candidates.map((p) => p.externalId));
    const extra = ranked
      .filter((p) => !usedIds.has(p.externalId))
      .slice(0, want - inStockOrUnknown.length)
      .map((product): PreviewCandidate => ({ product, inStock: null }));
    return [...inStockOrUnknown, ...extra].slice(0, want);
  }

  return inStockOrUnknown.slice(0, want);
}
