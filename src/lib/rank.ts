import type { CatalogProduct, SourceOrder } from "@/lib/catalog";

/**
 * Orders products by recency for the "Latest from {shop}" preview.
 *
 * publishedAt wins when known. Otherwise we fall back to source order, but
 * the tiebreak direction depends on how the source itself is ordered:
 * Shopify's products.json and sitemap <loc> order are oldest-first, so the
 * last item in the array is the newest; HTML collection pages are usually
 * newest-first already.
 */
export function rankRecent(
  products: CatalogProduct[],
  sourceOrder: SourceOrder,
): CatalogProduct[] {
  const indexDirection = sourceOrder === "newest-first" ? 1 : -1;

  return [...products].sort((a, b) => {
    if (a.publishedAt && b.publishedAt) {
      return b.publishedAt.getTime() - a.publishedAt.getTime();
    }
    if (a.publishedAt && !b.publishedAt) return -1;
    if (!a.publishedAt && b.publishedAt) return 1;
    return indexDirection * (a.sourceIndex - b.sourceIndex);
  });
}
