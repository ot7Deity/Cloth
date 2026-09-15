import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAvailability, pickPreviewCandidates } from "@/lib/availability";
import type { CatalogProduct } from "@/lib/catalog";

function fakeResponse(body: string, opts: { ok?: boolean; status?: number } = {}) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as Response;
}

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkAvailability", () => {
  it("reads variants[].available from the Shopify per-product endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse(JSON.stringify({ product: { variants: [{ available: false }, { available: true }] } })),
      ),
    );

    const result = await checkAvailability("https://shop.test/products/a", "shopify", new AbortController().signal);
    expect(result.inStock).toBe(true);
  });

  it("returns false when every Shopify variant is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse(JSON.stringify({ product: { variants: [{ available: false }] } })),
      ),
    );

    const result = await checkAvailability("https://shop.test/products/a", "shopify", new AbortController().signal);
    expect(result.inStock).toBe(false);
  });

  it("returns null on a 404 from the Shopify endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse("", { ok: false, status: 404 })));

    const result = await checkAvailability("https://shop.test/products/a", "shopify", new AbortController().signal);
    expect(result.inStock).toBeNull();
  });

  it("returns null on malformed JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse("not json")));

    const result = await checkAvailability("https://shop.test/products/a", "shopify", new AbortController().signal);
    expect(result.inStock).toBeNull();
  });

  it("reads schema.org availability out of HTML for non-Shopify sources", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse(`<html><script>"availability":"https://schema.org/OutOfStock"</script></html>`),
      ),
    );

    const result = await checkAvailability("https://shop.test/products/a", "html", new AbortController().signal);
    expect(result.inStock).toBe(false);
  });

  it("treats schema.org InStock as available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse(`<html><script>"availability":"https://schema.org/InStock"</script></html>`),
      ),
    );

    const result = await checkAvailability("https://shop.test/products/a", "html", new AbortController().signal);
    expect(result.inStock).toBe(true);
  });

  it("falls back to a bare 'sold out' text match", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse(`<html><body>Sold Out</body></html>`)));

    const result = await checkAvailability("https://shop.test/products/a", "html", new AbortController().signal);
    expect(result.inStock).toBe(false);
  });

  it("extracts og:image and og:title alongside availability", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        fakeResponse(
          `<html><head><meta property="og:title" content="Cool Shirt" /><meta property="og:image" content="https://cdn.test/a.jpg" /></head><body>In Stock</body></html>`,
        ),
      ),
    );

    const result = await checkAvailability("https://shop.test/products/a", "html", new AbortController().signal);
    expect(result.title).toBe("Cool Shirt");
    expect(result.imageUrl).toBe("https://cdn.test/a.jpg");
    expect(result.inStock).toBe(true);
  });

  it("returns null when a fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network error"); }));

    const result = await checkAvailability("https://shop.test/products/a", "html", new AbortController().signal);
    expect(result.inStock).toBeNull();
  });
});

describe("pickPreviewCandidates", () => {
  it("excludes sold-out candidates and returns up to `want`", async () => {
    const products = Array.from({ length: 12 }, (_, i) =>
      product({ externalId: String(i), productUrl: `https://shop.test/products/${i}`, sourceIndex: i }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const id = url.match(/products\/(\d+)/)?.[1];
        const soldOut = id === "0" || id === "2";
        return fakeResponse(
          JSON.stringify({ product: { variants: [{ available: !soldOut }] } }),
        );
      }),
    );

    const result = await pickPreviewCandidates(products, {
      sourceType: "shopify",
      sourceOrder: "oldest-first",
    });

    expect(result).toHaveLength(5);
    expect(result.some((c) => c.product.externalId === "0")).toBe(false);
    expect(result.some((c) => c.product.externalId === "2")).toBe(false);
  });

  it("still returns `want` products when availability is entirely indeterminate", async () => {
    const products = Array.from({ length: 12 }, (_, i) =>
      product({ externalId: String(i), productUrl: `https://shop.test/products/${i}`, sourceIndex: i }),
    );

    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse("", { ok: false, status: 404 })));

    const result = await pickPreviewCandidates(products, {
      sourceType: "html",
      sourceOrder: "newest-first",
    });

    expect(result).toHaveLength(5);
    expect(result.every((c) => c.inStock === null)).toBe(true);
  });

  it("returns fewer than `want` when the shop simply has fewer products", async () => {
    const products = [
      product({ externalId: "a", productUrl: "https://shop.test/products/a" }),
      product({ externalId: "b", productUrl: "https://shop.test/products/b" }),
      product({ externalId: "c", productUrl: "https://shop.test/products/c" }),
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(JSON.stringify({ product: { variants: [{ available: true }] } }))),
    );

    const result = await pickPreviewCandidates(products, {
      sourceType: "html",
      sourceOrder: "newest-first",
    });

    expect(result).toHaveLength(3);
  });

  it("treats a rejected availability check as indeterminate rather than throwing", async () => {
    const products = [
      product({ externalId: "a", productUrl: "https://shop.test/products/a" }),
      product({ externalId: "b", productUrl: "https://shop.test/products/b" }),
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/a")) throw new Error("boom");
        return fakeResponse(JSON.stringify({ product: { variants: [{ available: true }] } }));
      }),
    );

    const result = await pickPreviewCandidates(products, {
      sourceType: "html",
      sourceOrder: "newest-first",
    });

    expect(result).toHaveLength(2);
    expect(result.find((c) => c.product.externalId === "a")?.inStock).toBeNull();
  });

  it("skips the fetch entirely when Shopify already reported stock in the catalog", async () => {
    const fetchSpy = vi.fn(async () => fakeResponse(JSON.stringify({ product: { variants: [] } })));
    vi.stubGlobal("fetch", fetchSpy);

    const products = [
      product({ externalId: "a", inStock: true }),
      product({ externalId: "b", inStock: false, sourceIndex: 1 }),
    ];

    const result = await pickPreviewCandidates(products, {
      sourceType: "shopify",
      sourceOrder: "oldest-first",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.map((c) => c.product.externalId)).toEqual(["a"]);
  });

  it("returns an empty array for an empty catalog", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const result = await pickPreviewCandidates([], { sourceType: "html", sourceOrder: "newest-first" });

    expect(result).toEqual([]);
  });
});
