import { prisma } from "@/lib/prisma";
import { pickPreviewCandidates } from "@/lib/availability";
import type { CatalogResult } from "@/lib/catalog";

/**
 * Builds the "Latest from {shop}" preview row: ranks the catalog by
 * recency, checks in-stock status on a bounded set of candidates, and
 * persists the result as previewRank 1..5 on the Product rows. Kept
 * separate from the drops feed, whose isBaseline filter must stay strict.
 */
export async function buildShopPreview(
  shopId: string,
  result: CatalogResult,
): Promise<number> {
  const candidates = await pickPreviewCandidates(result.products, {
    sourceType: result.sourceType,
    sourceOrder: result.sourceOrder,
  });

  // Clear before writing so a shrinking preview (e.g. a shop now has fewer
  // in-stock candidates) doesn't leave stale ranks on old rows.
  await prisma.product.updateMany({
    where: { shopId, previewRank: { not: null } },
    data: { previewRank: null },
  });

  for (const [index, candidate] of candidates.entries()) {
    await prisma.product.update({
      where: {
        shopId_externalId: { shopId, externalId: candidate.product.externalId },
      },
      data: {
        previewRank: index + 1,
        inStock: candidate.inStock,
        ...(candidate.imageUrl ? { imageUrl: candidate.imageUrl } : {}),
        ...(candidate.title ? { title: candidate.title } : {}),
      },
    });
  }

  await prisma.shop.update({
    where: { id: shopId },
    data: { previewBuiltAt: new Date() },
  });

  return candidates.length;
}
