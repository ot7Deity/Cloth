import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Scoped by the caller's own Watch, not by Shop directly — otherwise any
  // signed-in user could probe whether an arbitrary shop id exists.
  const watch = await prisma.watch.findUnique({
    where: { userId_shopId: { userId: session.user.id, shopId: id } },
    select: {
      shop: {
        select: { id: true, name: true, host: true, status: true, lastError: true },
      },
    },
  });

  if (!watch) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const productCount = await prisma.product.count({ where: { shopId: id } });

  return NextResponse.json({ ...watch.shop, productCount });
}
