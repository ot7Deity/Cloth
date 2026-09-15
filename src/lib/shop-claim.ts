import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const SCAN_LEASE_MS = 5 * 60_000;

export type ClaimResult = {
  shop: { id: string; host: string; name: string; status: string };
  needsScan: boolean;
};

/**
 * Atomically decides whether the current request should (re-)scan a shop.
 *
 * Shop.host is globally unique, so multiple users tracking the same shop
 * share one row. Two races have to be handled:
 *  - two users track a brand-new host at the same instant
 *  - a second user tracks a shop another request is already scanning, or has
 *    already successfully scanned
 *
 * Both are resolved with a compare-and-swap on updateMany's returned count
 * rather than a read-then-write, so a shop already `active` is never
 * re-scanned and never has its status reset.
 */
export async function claimShopForScan(
  host: string,
  pageUrl: string,
): Promise<ClaimResult> {
  const existing = await prisma.shop.findUnique({ where: { host } });

  if (!existing) {
    try {
      const shop = await prisma.shop.create({
        data: {
          host,
          name: host.replace(/^www\./, ""),
          url: pageUrl,
          sourceType: "pending",
          status: "scanning",
          scanStartedAt: new Date(),
        },
      });
      return { shop, needsScan: true };
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      ) {
        throw error;
      }
      // Another request won the race to create this host; treat it as an
      // existing shop below.
      const shop = await prisma.shop.findUniqueOrThrow({ where: { host } });
      return { shop, needsScan: false };
    }
  }

  const staleCutoff = new Date(Date.now() - SCAN_LEASE_MS);
  const claimed = await prisma.shop.updateMany({
    where: {
      id: existing.id,
      OR: [
        { status: "unsupported" },
        { status: "scanning", scanStartedAt: { lt: staleCutoff } },
        { status: "scanning", scanStartedAt: null },
      ],
    },
    data: { status: "scanning", scanStartedAt: new Date(), lastError: null },
  });

  return { shop: existing, needsScan: claimed.count === 1 };
}
