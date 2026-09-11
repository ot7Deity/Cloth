import { prisma } from "@/lib/prisma";
import { probeCatalog, type CatalogProduct } from "@/lib/catalog";

export async function persistCatalog(shopId: string, products: CatalogProduct[]) {
  const existing = await prisma.product.findMany({
    where: { shopId },
    select: { externalId: true },
  });
  const existingIds = new Set(existing.map((p) => p.externalId));
  const isFirstSync = existingIds.size === 0;
  const now = new Date();

  for (const product of products) {
    const isNew = !existingIds.has(product.externalId);
    await prisma.product.upsert({
      where: {
        shopId_externalId: { shopId, externalId: product.externalId },
      },
      create: {
        shopId,
        externalId: product.externalId,
        title: product.title,
        productUrl: product.productUrl,
        imageUrl: product.imageUrl,
        isBaseline: isFirstSync,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        title: product.title,
        productUrl: product.productUrl,
        imageUrl: product.imageUrl ?? undefined,
        lastSeenAt: now,
      },
    });
    if (isNew) existingIds.add(product.externalId);
  }

  return { isFirstSync, count: products.length };
}

export async function syncShopById(shopId: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) return;

  try {
    const probed = await probeCatalog(shop.url);
    await persistCatalog(shop.id, probed.result.products);
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        name: probed.result.shopName,
        sourceType: probed.result.sourceType,
        status: "active",
        lastCheckedAt: new Date(),
        lastError: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Poll failed";
    await prisma.shop.update({
      where: { id: shop.id },
      data: {
        status: "unsupported",
        lastCheckedAt: new Date(),
        lastError: message,
      },
    });
  }
}

export async function pollAllShops() {
  const shops = await prisma.shop.findMany({
    where: { watches: { some: {} } },
    orderBy: { lastCheckedAt: "asc" },
  });

  for (const shop of shops) {
    await syncShopById(shop.id);
  }

  return { checked: shops.length };
}
