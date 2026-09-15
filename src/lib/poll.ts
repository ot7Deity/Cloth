import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { probeCatalog, type CatalogProduct } from "@/lib/catalog";
import { buildShopPreview } from "@/lib/preview";
import { SCAN_LEASE_MS } from "@/lib/shop-claim";

const CREATE_CHUNK = 500;
const TOUCH_CHUNK = 1000;
const PROBE_BUDGET_MS = 120_000;
const PREVIEW_REFRESH_MS = 6 * 60 * 60_000;

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

type ExistingRow = {
  externalId: string;
  title: string;
  productUrl: string;
  imageUrl: string | null;
  publishedAt: Date | null;
};

function metadataDiffers(next: CatalogProduct, prev: ExistingRow): boolean {
  return (
    next.title !== prev.title ||
    next.productUrl !== prev.productUrl ||
    (next.imageUrl != null && next.imageUrl !== prev.imageUrl) ||
    (next.publishedAt != null &&
      next.publishedAt.getTime() !== (prev.publishedAt?.getTime() ?? -1))
  );
}

export async function persistCatalog(
  shopId: string,
  products: CatalogProduct[],
  opts: { complete?: boolean } = {},
) {
  const complete = opts.complete ?? true;

  const [shop, existing] = await Promise.all([
    prisma.shop.findUnique({ where: { id: shopId }, select: { baselineAt: true } }),
    prisma.product.findMany({
      where: { shopId },
      select: {
        externalId: true,
        title: true,
        productUrl: true,
        imageUrl: true,
        publishedAt: true,
      },
    }),
  ]);

  const existingById = new Map(existing.map((p) => [p.externalId, p]));
  const isFirstSync = shop ? shop.baselineAt === null : existingById.size === 0;
  const now = new Date();

  // Sitemap/HTML sources can yield the same externalId twice within one
  // probe; createMany's skipDuplicates only guards against rows that already
  // exist, not duplicates inside the same insert batch.
  const deduped = [...new Map(products.map((p) => [p.externalId, p])).values()];

  const toCreate = deduped.filter((p) => !existingById.has(p.externalId));
  const toTouch = deduped.filter((p) => existingById.has(p.externalId));

  for (const chunk of chunked(toCreate, CREATE_CHUNK)) {
    await prisma.product.createMany({
      data: chunk.map((p) => ({
        shopId,
        externalId: p.externalId,
        title: p.title,
        productUrl: p.productUrl,
        imageUrl: p.imageUrl,
        publishedAt: p.publishedAt,
        sourceIndex: p.sourceIndex,
        isBaseline: isFirstSync,
        firstSeenAt: now,
        lastSeenAt: now,
      })),
      skipDuplicates: true,
    });
  }

  for (const chunk of chunked(
    toTouch.map((p) => p.externalId),
    TOUCH_CHUNK,
  )) {
    await prisma.product.updateMany({
      where: { shopId, externalId: { in: chunk } },
      data: { lastSeenAt: now },
    });
  }

  const changed = toTouch.filter((p) => metadataDiffers(p, existingById.get(p.externalId)!));
  for (const p of changed) {
    await prisma.product.update({
      where: { shopId_externalId: { shopId, externalId: p.externalId } },
      data: {
        title: p.title,
        productUrl: p.productUrl,
        imageUrl: p.imageUrl ?? undefined,
        publishedAt: p.publishedAt ?? undefined,
      },
    });
  }

  if (isFirstSync && complete) {
    await prisma.shop.update({ where: { id: shopId }, data: { baselineAt: now } });
  }

  return { isFirstSync, count: products.length };
}

/**
 * Shared entry point for both the after()-backgrounded import triggered by
 * addShopAction and the cron sweep/poll. Advances Shop.status through the
 * scanning -> active | unsupported lifecycle; a truncated probe (ran out of
 * budget) deliberately leaves status at "scanning" with a refreshed lease so
 * the next sweep resumes it, rather than baselining a partial catalog.
 */
export async function importShop(shopId: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) return;

  try {
    const probed = await probeCatalog(shop.url, { budgetMs: PROBE_BUDGET_MS });

    await prisma.shop.update({
      where: { id: shopId },
      data: {
        name: probed.result.shopName,
        url: probed.pageUrl,
        sourceType: probed.result.sourceType,
        sourceOrder: probed.result.sourceOrder,
      },
    });

    await persistCatalog(shopId, probed.result.products, { complete: probed.complete });

    if (!probed.complete) {
      await prisma.shop.update({
        where: { id: shopId },
        data: { scanStartedAt: new Date() },
      });
      return;
    }

    const needsPreview =
      !shop.previewBuiltAt || Date.now() - shop.previewBuiltAt.getTime() > PREVIEW_REFRESH_MS;
    if (needsPreview) {
      await buildShopPreview(shopId, probed.result);
    }

    await prisma.shop.update({
      where: { id: shopId },
      data: {
        status: "active",
        scanStartedAt: null,
        lastCheckedAt: new Date(),
        lastError: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Poll failed";
    await prisma.shop.update({
      where: { id: shopId },
      data: {
        status: "unsupported",
        scanStartedAt: null,
        lastCheckedAt: new Date(),
        lastError: message,
      },
    });
  }

  revalidatePath("/");
  revalidatePath("/shops");
}

/** Kept as an alias: this is the previous public name for importShop. */
export const syncShopById = importShop;

export async function sweepStuckScans() {
  const cutoff = new Date(Date.now() - SCAN_LEASE_MS);
  const stuck = await prisma.shop.findMany({
    where: { status: "scanning", scanStartedAt: { lt: cutoff }, watches: { some: {} } },
    select: { id: true },
  });

  let resumed = 0;
  for (const { id } of stuck) {
    const claimed = await prisma.shop.updateMany({
      where: { id, status: "scanning", scanStartedAt: { lt: cutoff } },
      data: { scanStartedAt: new Date() },
    });
    if (claimed.count === 1) {
      await importShop(id);
      resumed += 1;
    }
  }

  return { resumed };
}

export async function pollAllShops() {
  const shops = await prisma.shop.findMany({
    where: { watches: { some: {} }, status: { not: "scanning" } },
    orderBy: { lastCheckedAt: "asc" },
  });

  for (const shop of shops) {
    await importShop(shop.id);
  }

  return { checked: shops.length };
}
