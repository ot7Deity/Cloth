import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogProduct } from "@/lib/catalog";

const findMany = vi.fn();
const createMany = vi.fn();
const updateMany = vi.fn();
const update = vi.fn();
const shopFindUnique = vi.fn();
const shopUpdate = vi.fn();
const shopFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findMany: (...a: unknown[]) => findMany(...a),
      createMany: (...a: unknown[]) => createMany(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
      update: (...a: unknown[]) => update(...a),
    },
    shop: {
      findUnique: (...a: unknown[]) => shopFindUnique(...a),
      update: (...a: unknown[]) => shopUpdate(...a),
      findMany: (...a: unknown[]) => shopFindMany(...a),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/catalog")>();
  return { ...actual, probeCatalog: vi.fn() };
});

vi.mock("@/lib/preview", () => ({
  buildShopPreview: vi.fn(),
}));

const { persistCatalog, pollAllShops } = await import("@/lib/poll");

function product(externalId: string, overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    externalId,
    title: `Product ${externalId}`,
    productUrl: `https://shop.test/products/${externalId}`,
    imageUrl: null,
    publishedAt: null,
    sourceIndex: 0,
    inStock: null,
    ...overrides,
  };
}

beforeEach(() => {
  findMany.mockReset();
  createMany.mockReset().mockResolvedValue({ count: 0 });
  updateMany.mockReset().mockResolvedValue({ count: 0 });
  update.mockReset();
  shopFindUnique.mockReset();
  shopUpdate.mockReset();
  shopFindMany.mockReset().mockResolvedValue([]);
});

describe("persistCatalog", () => {
  it("marks every product as baseline on a shop's first sync", async () => {
    shopFindUnique.mockResolvedValue({ baselineAt: null });
    findMany.mockResolvedValue([]);

    const { isFirstSync, count } = await persistCatalog("shop-1", [product("a"), product("b")]);

    expect(isFirstSync).toBe(true);
    expect(count).toBe(2);
    expect(createMany).toHaveBeenCalledTimes(1);
    const data = createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(2);
    expect(data.every((d: { isBaseline: boolean }) => d.isBaseline === true)).toBe(true);
    expect(shopUpdate).toHaveBeenCalledWith({
      where: { id: "shop-1" },
      data: { baselineAt: expect.any(Date) },
    });
  });

  it("does not mark products as baseline on later syncs, even new ones", async () => {
    shopFindUnique.mockResolvedValue({ baselineAt: new Date("2024-01-01") });
    findMany.mockResolvedValue([
      {
        externalId: "a",
        title: "Product a",
        productUrl: "https://shop.test/products/a",
        imageUrl: null,
        publishedAt: null,
      },
    ]);

    const { isFirstSync } = await persistCatalog("shop-1", [product("a"), product("b")]);

    expect(isFirstSync).toBe(false);
    const data = createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(1);
    expect(data[0].externalId).toBe("b");
    expect(data[0].isBaseline).toBe(false);
    expect(shopUpdate).not.toHaveBeenCalled();
  });

  it("still reports isFirstSync when rows exist but baselineAt is null (resumed partial import)", async () => {
    shopFindUnique.mockResolvedValue({ baselineAt: null });
    findMany.mockResolvedValue([
      {
        externalId: "a",
        title: "Product a",
        productUrl: "https://shop.test/products/a",
        imageUrl: null,
        publishedAt: null,
      },
    ]);

    const { isFirstSync } = await persistCatalog("shop-1", [product("a"), product("b")]);

    expect(isFirstSync).toBe(true);
    const data = createMany.mock.calls[0][0].data;
    expect(data[0].isBaseline).toBe(true);
  });

  it("does not set baselineAt when the sync was incomplete", async () => {
    shopFindUnique.mockResolvedValue({ baselineAt: null });
    findMany.mockResolvedValue([]);

    await persistCatalog("shop-1", [product("a")], { complete: false });

    expect(shopUpdate).not.toHaveBeenCalled();
  });

  it("touches lastSeenAt in bulk for products that already exist", async () => {
    shopFindUnique.mockResolvedValue({ baselineAt: new Date() });
    findMany.mockResolvedValue([
      {
        externalId: "a",
        title: "Product a",
        productUrl: "https://shop.test/products/a",
        imageUrl: null,
        publishedAt: null,
      },
    ]);

    await persistCatalog("shop-1", [product("a")]);

    expect(updateMany).toHaveBeenCalledWith({
      where: { shopId: "shop-1", externalId: { in: ["a"] } },
      data: { lastSeenAt: expect.any(Date) },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("updates metadata only for existing products whose data actually changed", async () => {
    shopFindUnique.mockResolvedValue({ baselineAt: new Date() });
    findMany.mockResolvedValue([
      {
        externalId: "a",
        title: "Old Title",
        productUrl: "https://shop.test/products/a",
        imageUrl: null,
        publishedAt: null,
      },
    ]);

    await persistCatalog("shop-1", [product("a", { title: "New Title" })]);

    expect(update).toHaveBeenCalledWith({
      where: { shopId_externalId: { shopId: "shop-1", externalId: "a" } },
      data: expect.objectContaining({ title: "New Title" }),
    });
  });

  it("dedupes repeated externalIds within one input while count stays the raw length", async () => {
    shopFindUnique.mockResolvedValue({ baselineAt: null });
    findMany.mockResolvedValue([]);

    const { count } = await persistCatalog("shop-1", [product("a"), product("a"), product("b")]);

    expect(count).toBe(3);
    const data = createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(2);
  });
});

describe("pollAllShops", () => {
  it("excludes shops currently in flight from cron's own poll", async () => {
    shopFindMany.mockResolvedValue([]);

    await pollAllShops();

    expect(shopFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: "scanning" } }),
      }),
    );
  });
});
