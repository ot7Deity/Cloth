import { describe, expect, it } from "vitest";
import { rankRecent } from "@/lib/rank";
import type { CatalogProduct } from "@/lib/catalog";

function product(overrides: Partial<CatalogProduct>): CatalogProduct {
  return {
    externalId: "id",
    title: "Product",
    productUrl: "https://shop.test/products/id",
    imageUrl: null,
    publishedAt: null,
    sourceIndex: 0,
    inStock: null,
    ...overrides,
  };
}

describe("rankRecent", () => {
  it("ranks products with a publishedAt above those without one", () => {
    const withDate = product({ externalId: "a", publishedAt: new Date("2024-01-01"), sourceIndex: 5 });
    const withoutDate = product({ externalId: "b", publishedAt: null, sourceIndex: 0 });

    const ranked = rankRecent([withoutDate, withDate], "unknown");

    expect(ranked.map((p) => p.externalId)).toEqual(["a", "b"]);
  });

  it("orders by publishedAt descending when both have dates", () => {
    const older = product({ externalId: "old", publishedAt: new Date("2024-01-01") });
    const newer = product({ externalId: "new", publishedAt: new Date("2024-06-01") });

    const ranked = rankRecent([older, newer], "unknown");

    expect(ranked.map((p) => p.externalId)).toEqual(["new", "old"]);
  });

  it("tiebreaks ascending by sourceIndex when the source is newest-first", () => {
    const first = product({ externalId: "first", sourceIndex: 0 });
    const second = product({ externalId: "second", sourceIndex: 1 });

    const ranked = rankRecent([second, first], "newest-first");

    expect(ranked.map((p) => p.externalId)).toEqual(["first", "second"]);
  });

  it("tiebreaks descending by sourceIndex when the source is oldest-first", () => {
    const early = product({ externalId: "early", sourceIndex: 0 });
    const late = product({ externalId: "late", sourceIndex: 1 });

    const ranked = rankRecent([early, late], "oldest-first");

    expect(ranked.map((p) => p.externalId)).toEqual(["late", "early"]);
  });

  it("treats unknown source order like oldest-first for the tiebreak", () => {
    const early = product({ externalId: "early", sourceIndex: 0 });
    const late = product({ externalId: "late", sourceIndex: 1 });

    const ranked = rankRecent([early, late], "unknown");

    expect(ranked.map((p) => p.externalId)).toEqual(["late", "early"]);
  });

  it("falls back entirely to source-index order when no product has a publishedAt", () => {
    const products = [
      product({ externalId: "c", sourceIndex: 2 }),
      product({ externalId: "a", sourceIndex: 0 }),
      product({ externalId: "b", sourceIndex: 1 }),
    ];

    const ranked = rankRecent(products, "newest-first");

    expect(ranked.map((p) => p.externalId)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const products = [product({ externalId: "a", sourceIndex: 1 }), product({ externalId: "b", sourceIndex: 0 })];
    const original = [...products];

    rankRecent(products, "newest-first");

    expect(products).toEqual(original);
  });
});
