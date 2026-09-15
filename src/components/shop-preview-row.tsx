import { ProductCard } from "@/components/product-card";

type PreviewProduct = {
  id: string;
  title: string;
  productUrl: string;
  imageUrl: string | null;
};

type ShopPreviewRowProps = {
  shopName: string;
  status: "scanning" | "active" | "unsupported";
  lastError: string | null;
  products: PreviewProduct[];
};

export function ShopPreviewRow({ shopName, status, lastError, products }: ShopPreviewRowProps) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-medium tracking-tight">
          {status === "active" ? `Latest from ${shopName}` : shopName}
        </h2>
        <p className="text-xs text-zinc-500">
          Recent in-stock picks — these aren&rsquo;t counted as new drops.
        </p>
      </div>

      {status === "scanning" ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[4/5] animate-pulse border border-white/10 bg-zinc-900"
            />
          ))}
        </div>
      ) : null}

      {status === "unsupported" ? (
        <p className="text-sm text-red-400">
          {lastError ?? "Could not read this shop's catalog."}
        </p>
      ) : null}

      {status === "active" ? (
        products.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                title={product.title}
                shopName={shopName}
                productUrl={product.productUrl}
                imageUrl={product.imageUrl}
                footnote="In stock"
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No in-stock picks found yet.</p>
        )
      ) : null}
    </section>
  );
}
