import { beforeEach, describe, expect, it, vi } from "vitest";

const shopFindUnique = vi.fn();
const shopUpdate = vi.fn();
const shopUpdateMany = vi.fn();
const shopFindMany = vi.fn();
const productFindMany = vi.fn();
const productCreateMany = vi.fn();
const productUpdateMany = vi.fn();
const productUpdate = vi.fn();
const probeCatalog = vi.fn();
const buildShopPreview = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    shop: {
      findUnique: (...a: unknown[]) => shopFindUnique(...a),
      update: (...a: unknown[]) => shopUpdate(...a),
      updateMany: (...a: unknown[]) => shopUpdateMany(...a),
      findMany: (...a: unknown[]) => shopFindMany(...a),
    },
    product: {
      findMany: (...a: unknown[]) => productFindMany(...a),
      createMany: (...a: unknown[]) => productCreateMany(...a),
      updateMany: (...a: unknown[]) => productUpdateMany(...a),
      update: (...a: unknown[]) => productUpdate(...a),
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

vi.mock("@/lib/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/catalog")>();
  return { ...actual, probeCatalog: (...a: unknown[]) => probeCatalog(...a) };
});

vi.mock("@/lib/preview", () => ({
  buildShopPreview: (...a: unknown[]) => buildShopPreview(...a),
}));

const { importShop, sweepStuckScans } = await import("@/lib/poll");

function shop(overrides: Record<string, unknown> = {}) {
  return {
    id: "shop-1",
    host: "shop.test",
    url: "https://shop.test/",
    previewBuiltAt: null,
    ...overrides,
  };
}

function probedResult(overrides: Record<string, unknown> = {}) {
  return {
    origin: "https://shop.test",
    host: "shop.test",
    pageUrl: "https://shop.test/",
    complete: true,
    result: {
      sourceType: "shopify",
      sourceOrder: "oldest-first",
      shopName: "Shop",
      products: [],
    },
    ...overrides,
  };
}

beforeEach(() => {
  shopFindUnique.mockReset();
  shopUpdate.mockReset();
  shopUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  shopFindMany.mockReset().mockResolvedValue([]);
  productFindMany.mockReset().mockResolvedValue([]);
  productCreateMany.mockReset().mockResolvedValue({ count: 0 });
  productUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  productUpdate.mockReset();
  probeCatalog.mockReset();
  buildShopPreview.mockReset();
  revalidatePath.mockReset();
});

describe("importShop", () => {
  it("marks the shop active and builds the preview on a successful, complete scan", async () => {
    shopFindUnique.mockResolvedValue(shop());
    probeCatalog.mockResolvedValue(probedResult());

    await importShop("shop-1");

    expect(buildShopPreview).toHaveBeenCalled();
    expect(shopUpdate).toHaveBeenCalledWith({
      where: { id: "shop-1" },
      data: {
        status: "active",
        scanStartedAt: null,
        lastCheckedAt: expect.any(Date),
        lastError: null,
      },
    });
  });

  it("marks the shop unsupported when the probe throws", async () => {
    shopFindUnique.mockResolvedValue(shop());
    probeCatalog.mockRejectedValue(new Error("no catalog found"));

    await importShop("shop-1");

    expect(shopUpdate).toHaveBeenCalledWith({
      where: { id: "shop-1" },
      data: {
        status: "unsupported",
        scanStartedAt: null,
        lastCheckedAt: expect.any(Date),
        lastError: "no catalog found",
      },
    });
    expect(buildShopPreview).not.toHaveBeenCalled();
  });

  it("keeps status scanning and refreshes the lease when the probe is truncated", async () => {
    shopFindUnique.mockResolvedValue(shop());
    probeCatalog.mockResolvedValue(probedResult({ complete: false }));

    await importShop("shop-1");

    expect(shopUpdate).toHaveBeenCalledWith({
      where: { id: "shop-1" },
      data: { scanStartedAt: expect.any(Date) },
    });
    expect(shopUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "active" }) }),
    );
    expect(buildShopPreview).not.toHaveBeenCalled();
  });

  it("skips rebuilding the preview when it was refreshed recently", async () => {
    shopFindUnique.mockResolvedValue(shop({ previewBuiltAt: new Date() }));
    probeCatalog.mockResolvedValue(probedResult());

    await importShop("shop-1");

    expect(buildShopPreview).not.toHaveBeenCalled();
  });

  it("does nothing when the shop no longer exists", async () => {
    shopFindUnique.mockResolvedValue(null);

    await importShop("shop-1");

    expect(probeCatalog).not.toHaveBeenCalled();
    expect(shopUpdate).not.toHaveBeenCalled();
  });
});

describe("sweepStuckScans", () => {
  it("imports a stuck shop when it wins the CAS re-claim", async () => {
    shopFindMany.mockResolvedValue([{ id: "shop-1" }]);
    shopUpdateMany.mockResolvedValue({ count: 1 });
    shopFindUnique.mockResolvedValue(shop());
    probeCatalog.mockResolvedValue(probedResult());

    const result = await sweepStuckScans();

    expect(probeCatalog).toHaveBeenCalled();
    expect(result.resumed).toBe(1);
  });

  it("does not import a stuck shop when it loses the CAS re-claim to another worker", async () => {
    shopFindMany.mockResolvedValue([{ id: "shop-1" }]);
    shopUpdateMany.mockResolvedValue({ count: 0 });

    const result = await sweepStuckScans();

    expect(probeCatalog).not.toHaveBeenCalled();
    expect(shopFindUnique).not.toHaveBeenCalled();
    expect(result.resumed).toBe(0);
  });

  it("only sweeps shops that are still watched", async () => {
    shopFindMany.mockResolvedValue([]);

    await sweepStuckScans();

    expect(shopFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "scanning", watches: { some: {} } }),
      }),
    );
  });
});
