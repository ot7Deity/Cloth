import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeShopUrl, probeCatalog } from "@/lib/catalog";

function fakeResponse(body: string, opts: { ok?: boolean; status?: number; url?: string } = {}) {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    url: opts.url ?? "",
    text: async () => body,
  } as Response;
}

const notFound = fakeResponse("", { ok: false, status: 404 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeShopUrl", () => {
  it("adds https:// when no protocol is given", () => {
    expect(normalizeShopUrl("example.com").toString()).toBe("https://example.com/");
  });

  it("keeps an explicit protocol", () => {
    expect(normalizeShopUrl("http://example.com/shop").protocol).toBe("http:");
  });

  it("throws on an unparseable URL", () => {
    expect(() => normalizeShopUrl("not a url")).toThrow();
  });
});

describe("probeCatalog", () => {
  const origin = "https://shop.test";

  it("prefers the Shopify products.json catalog when available", async () => {
    const home = fakeResponse(
      `<html><head><title>My Cool Shop | Streetwear</title></head><body></body></html>`,
    );
    const shopifyPage1 = fakeResponse(
      JSON.stringify({
        products: [
          {
            id: 1,
            title: "Cool Shirt",
            handle: "cool-shirt",
            images: [{ src: "//cdn.test/cool.jpg" }],
          },
          { id: 2, handle: "rad-pants-handle", images: [] },
        ],
      }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/products.json")) return shopifyPage1;
        return home;
      }),
    );

    const { result } = await probeCatalog(origin);

    expect(result.sourceType).toBe("shopify");
    expect(result.shopName).toBe("My Cool Shop");
    expect(result.products).toEqual([
      {
        externalId: "1",
        title: "Cool Shirt",
        productUrl: `${origin}/products/cool-shirt`,
        imageUrl: "https://cdn.test/cool.jpg",
      },
      {
        externalId: "2",
        title: "rad pants handle",
        productUrl: `${origin}/products/rad-pants-handle`,
        imageUrl: null,
      },
    ]);
  });

  it("falls back to the sitemap when Shopify's products.json is unavailable", async () => {
    const home = fakeResponse(
      `<html><head><meta property="og:site_name" content="Sitemap Shop" /></head></html>`,
    );
    const sitemap = fakeResponse(`<urlset>
      <url><loc>${origin}/products/aaa?variant=1</loc></url>
      <url><loc>${origin}/products/bbb</loc></url>
      <url><loc>${origin}/about</loc></url>
    </urlset>`);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/products.json")) return notFound;
        if (url.includes("sitemap_products_1.xml")) return sitemap;
        return home;
      }),
    );

    const { result } = await probeCatalog(origin);

    expect(result.sourceType).toBe("sitemap");
    expect(result.shopName).toBe("Sitemap Shop");
    expect(result.products).toHaveLength(2);
    expect(result.products.map((p) => p.productUrl).sort()).toEqual([
      `${origin}/products/aaa`,
      `${origin}/products/bbb`,
    ]);
  });

  it("falls back to scraping product links from the HTML page as a last resort", async () => {
    const home = fakeResponse(`<html><head>
        <meta property="og:site_name" content="Shop Test" />
      </head><body>
        <a href="/products/cool-shirt">Cool Shirt</a>
        <a href="/products/rad-pants">Rad Pants</a>
        <a href="/about">About</a>
      </body></html>`);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/products.json")) return notFound;
        if (url.includes("sitemap")) return notFound;
        return home;
      }),
    );

    const { result } = await probeCatalog(origin);

    expect(result.sourceType).toBe("html");
    expect(result.shopName).toBe("Shop Test");
    expect(result.products.map((p) => p.title).sort()).toEqual(["cool shirt", "rad pants"]);
  });

  it("throws when no catalog can be found at all", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => notFound));

    await expect(probeCatalog(origin)).rejects.toThrow(/could not find a product catalog/i);
  });
});
