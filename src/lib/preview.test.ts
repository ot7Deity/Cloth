import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogResult } from "@/lib/catalog";

const updateMany = vi.fn();
const update = vi.fn();
const shopUpdate = vi.fn();
const pickPreviewCandidates = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    product: {
      updateMany: (...a: unknown[]) => updateMany(...a),
      update: (...a: unknown[]) => update(...a),
    },
    shop: {
      update: (...a: unknown[]) => shopUpdate(...a),
    },
  },
}));

vi.mock("@/lib/availability", () => ({
  pickPreviewCandidates: (...a: unknown[]) => pickPreviewCandidates(...a),
}));

const { buildShopPreview } = await import("@/lib/preview");

function result(): CatalogResult {
  return {
    sourceType: "shopify",
    sourceOrder: "oldest-first",
    shopName: "Shop",
    products: [],
  };
}

function candidate(externalId: string, inStock: boolean | null = true) {
  return {
    product: {
      externalId,
      title: `Product ${externalId}`,
      productUrl: `https://shop.test/products/${externalId}`,
      imageUrl: null,
      publishedAt: null,
      sourceIndex: 0,
      inStock,
    },
    inStock,
  };
}

beforeEach(() => {
  updateMany.mockReset().mockResolvedValue({ count: 0 });
  update.mockReset();
  shopUpdate.mockReset();
  pickPreviewCandidates.mockReset();
});

describe("buildShopPreview", () => {
  it("clears the existing preview before writing new ranks", async () => {
    pickPreviewCandidates.mockResolvedValue([candidate("a"), candidate("b")]);

    await buildShopPreview("shop-1", result());

    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      update.mock.invocationCallOrder[0],
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { shopId: "shop-1", previewRank: { not: null } },
      data: { previewRank: null },
    });
  });

  it("writes previewRank 1..N in rank order", async () => {
    pickPreviewCandidates.mockResolvedValue([candidate("a"), candidate("b"), candidate("c")]);

    await buildShopPreview("shop-1", result());

    expect(update).toHaveBeenCalledTimes(3);
    expect(update.mock.calls[0][0]).toMatchObject({
      where: { shopId_externalId: { shopId: "shop-1", externalId: "a" } },
      data: expect.objectContaining({ previewRank: 1 }),
    });
    expect(update.mock.calls[1][0]).toMatchObject({
      data: expect.objectContaining({ previewRank: 2 }),
    });
    expect(update.mock.calls[2][0]).toMatchObject({
      data: expect.objectContaining({ previewRank: 3 }),
    });
  });

  it("stamps previewBuiltAt on the shop", async () => {
    pickPreviewCandidates.mockResolvedValue([]);

    await buildShopPreview("shop-1", result());

    expect(shopUpdate).toHaveBeenCalledWith({
      where: { id: "shop-1" },
      data: { previewBuiltAt: expect.any(Date) },
    });
  });

  it("returns the number of preview products written", async () => {
    pickPreviewCandidates.mockResolvedValue([candidate("a"), candidate("b")]);

    const count = await buildShopPreview("shop-1", result());

    expect(count).toBe(2);
  });
});
