import { auth } from "@/auth";
import { unwatchAction } from "@/app/actions";
import { Header } from "@/components/header";
import { TrackForm } from "@/components/track-form";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export default async function ShopsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const watches = await prisma.watch.findMany({
    where: { userId: session.user.id },
    include: { shop: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="flex min-h-full flex-col">
      <Header username={session.user.username} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-10">
        <section className="space-y-4">
          <h1 className="text-3xl font-medium tracking-tight">Your shops</h1>
          <p className="text-sm text-zinc-400">
            Paste another underground shop. We read the catalog once, then poll
            for new products.
          </p>
          <TrackForm />
        </section>

        {watches.length === 0 ? (
          <p className="text-sm text-zinc-500">You are not tracking any shops yet.</p>
        ) : (
          <ul className="divide-y divide-white/10 border border-white/10">
            {watches.map((watch) => (
              <li
                key={watch.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{watch.shop.name}</p>
                  <p className="text-sm text-zinc-500">{watch.shop.host}</p>
                  <p className="mt-1 text-xs uppercase tracking-wide text-zinc-600">
                    {watch.shop.sourceType}
                    {watch.shop.status === "unsupported"
                      ? " · could not refresh"
                      : ""}
                    {watch.shop.lastCheckedAt
                      ? ` · checked ${watch.shop.lastCheckedAt.toLocaleString()}`
                      : ""}
                  </p>
                  {watch.shop.lastError ? (
                    <p className="mt-1 text-xs text-red-400">{watch.shop.lastError}</p>
                  ) : null}
                </div>
                <form action={unwatchAction}>
                  <input type="hidden" name="shopId" value={watch.shopId} />
                  <button
                    type="submit"
                    className="text-sm text-zinc-400 hover:text-white"
                  >
                    Untrack
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
