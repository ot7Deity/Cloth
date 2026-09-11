import Link from "next/link";
import { auth } from "@/auth";
import { Header } from "@/components/header";
import { ProductCard } from "@/components/product-card";
import { TrackForm } from "@/components/track-form";
import { prisma } from "@/lib/prisma";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ shop?: string }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  const { shop: shopFilter } = await searchParams;

  if (!userId) {
    return (
      <div className="flex min-h-full flex-col">
        <Header />
        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-24">
          <p className="text-xs tracking-[0.35em] uppercase text-zinc-500">
            Underground drops
          </p>
          <h1 className="mt-4 text-4xl font-medium tracking-tight">Cloth</h1>
          <p className="mt-4 text-zinc-400">
            Track small shops. See new products in one feed. Follow people and
            pickups come later.
          </p>
          <div className="mt-10 flex gap-4">
            <Link
              href="/signup"
              className="border border-white bg-white px-5 py-3 text-sm font-medium tracking-wide text-black uppercase"
            >
              Sign up
            </Link>
            <Link
              href="/login"
              className="border border-white/20 px-5 py-3 text-sm tracking-wide uppercase"
            >
              Log in
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const watches = await prisma.watch.findMany({
    where: { userId },
    include: { shop: true },
    orderBy: { createdAt: "desc" },
  });

  const shopIds = watches.map((w) => w.shopId);
  const activeFilter =
    shopFilter && shopIds.includes(shopFilter) ? shopFilter : undefined;

  const products = shopIds.length
    ? await prisma.product.findMany({
        where: {
          shopId: activeFilter ? activeFilter : { in: shopIds },
          isBaseline: false,
        },
        include: { shop: true },
        orderBy: { firstSeenAt: "desc" },
        take: 60,
      })
    : [];

  return (
    <div className="flex min-h-full flex-col">
      <Header username={session.user.username} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-4 py-10">
        <section className="max-w-2xl space-y-4">
          <h1 className="text-3xl font-medium tracking-tight">Recent adds</h1>
          <p className="text-sm text-zinc-400">
            New products from shops you track. The first scan is a baseline so
            the whole catalog does not show up as new.
          </p>
          <TrackForm />
        </section>

        {watches.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Link
              href="/"
              className={`border px-3 py-1.5 text-xs tracking-wide uppercase ${
                !activeFilter
                  ? "border-white bg-white text-black"
                  : "border-white/15 text-zinc-400"
              }`}
            >
              All
            </Link>
            {watches.map((watch) => (
              <Link
                key={watch.id}
                href={`/?shop=${watch.shopId}`}
                className={`border px-3 py-1.5 text-xs tracking-wide uppercase ${
                  activeFilter === watch.shopId
                    ? "border-white bg-white text-black"
                    : "border-white/15 text-zinc-400"
                }`}
              >
                {watch.shop.name}
              </Link>
            ))}
          </div>
        ) : null}

        {products.length === 0 ? (
          <p className="text-sm text-zinc-500">
            {watches.length === 0
              ? "Paste a shop URL to start tracking."
              : "No new products yet. Check back after the next poll, or add another shop."}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                title={product.title}
                shopName={product.shop.name}
                productUrl={product.productUrl}
                imageUrl={product.imageUrl}
                firstSeenAt={product.firstSeenAt}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
