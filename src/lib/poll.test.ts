import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogProduct } from "@/lib/catalog";

const findMany = vi.fn();
const upsert = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      findMany: (...args: unknown[]) => findMany(...args),
      upsert: (...args: unknown[]) => upsert(...args),
    },
  },
}));

const { persistCatalog } = await import("@/lib/poll");

function product(externalId: string): CatalogProduct {
  return {
    externalId,
    title: `Product ${externalId}`,
    productUrl: `https://shop.test/products/${externalId}`,
    imageUrl: null,
  };
}

beforeEach(() => {
  findMany.mockReset();
  upsert.mockReset();
});

describe("persistCatalog", () => {
  it("marks every product as baseline on a shop's first sync", async () => {
    findMany.mockResolvedValue([]);

    const { isFirstSync, count } = await persistCatalog("shop-1", [product("a"), product("b")]);

    expect(isFirstSync).toBe(true);
    expect(count).toBe(2);
    expect(upsert).toHaveBeenCalledTimes(2);
    for (const call of upsert.mock.calls) {
      expect(call[0].create.isBaseline).toBe(true);
    }
  });

  it("does not mark products as baseline on later syncs, even new ones", async () => {
    findMany.mockResolvedValue([{ externalId: "a" }]);

    const { isFirstSync } = await persistCatalog("shop-1", [product("a"), product("b")]);

    expect(isFirstSync).toBe(false);
    for (const call of upsert.mock.calls) {
      expect(call[0].create.isBaseline).toBe(false);
    }
  });

  it("upserts on the shopId/externalId key and refreshes lastSeenAt on update", async () => {
    findMany.mockResolvedValue([{ externalId: "a" }]);

    await persistCatalog("shop-1", [product("a")]);

    const call = upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      shopId_externalId: { shopId: "shop-1", externalId: "a" },
    });
    expect(call.update.lastSeenAt).toBeInstanceOf(Date);
  });
});
