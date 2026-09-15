import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const findUnique = vi.fn();
const findUniqueOrThrow = vi.fn();
const create = vi.fn();
const updateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    shop: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      findUniqueOrThrow: (...a: unknown[]) => findUniqueOrThrow(...a),
      create: (...a: unknown[]) => create(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
    },
  },
}));

const { claimShopForScan, SCAN_LEASE_MS } = await import("@/lib/shop-claim");

beforeEach(() => {
  findUnique.mockReset();
  findUniqueOrThrow.mockReset();
  create.mockReset();
  updateMany.mockReset();
});

describe("claimShopForScan", () => {
  it("creates a scanning shop for a brand-new host", async () => {
    findUnique.mockResolvedValue(null);
    const created = { id: "shop-1", host: "shop.test", name: "shop.test", status: "scanning" };
    create.mockResolvedValue(created);

    const result = await claimShopForScan("shop.test", "https://shop.test/");

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ host: "shop.test", status: "scanning" }),
      }),
    );
    expect(result).toEqual({ shop: created, needsScan: true });
  });

  it("does not re-scan and does not reset status for an already-active shop", async () => {
    const active = { id: "shop-1", host: "shop.test", name: "Shop", status: "active" };
    findUnique.mockResolvedValue(active);
    updateMany.mockResolvedValue({ count: 0 });

    const result = await claimShopForScan("shop.test", "https://shop.test/");

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "shop-1" }),
      }),
    );
    const call = updateMany.mock.calls[0][0];
    expect(call.where.OR).not.toContainEqual(expect.objectContaining({ status: "active" }));
    expect(result).toEqual({ shop: active, needsScan: false });
  });

  it("does not re-claim a scan with a fresh lease", async () => {
    const scanning = {
      id: "shop-1",
      host: "shop.test",
      name: "Shop",
      status: "scanning",
    };
    findUnique.mockResolvedValue(scanning);
    updateMany.mockResolvedValue({ count: 0 });

    const result = await claimShopForScan("shop.test", "https://shop.test/");

    expect(result.needsScan).toBe(false);
  });

  it("re-claims a scan whose lease has gone stale", async () => {
    const scanning = { id: "shop-1", host: "shop.test", name: "Shop", status: "scanning" };
    findUnique.mockResolvedValue(scanning);
    updateMany.mockResolvedValue({ count: 1 });

    const result = await claimShopForScan("shop.test", "https://shop.test/");

    const call = updateMany.mock.calls[0][0];
    expect(call.where.OR).toContainEqual({
      status: "scanning",
      scanStartedAt: { lt: expect.any(Date) },
    });
    expect(result.needsScan).toBe(true);
  });

  it("loses the race when updateMany matches zero rows", async () => {
    const failed = { id: "shop-1", host: "shop.test", name: "Shop", status: "unsupported" };
    findUnique.mockResolvedValue(failed);
    updateMany.mockResolvedValue({ count: 0 });

    const result = await claimShopForScan("shop.test", "https://shop.test/");

    expect(result.needsScan).toBe(false);
  });

  it("retries a previously-failed shop", async () => {
    const failed = { id: "shop-1", host: "shop.test", name: "Shop", status: "unsupported" };
    findUnique.mockResolvedValue(failed);
    updateMany.mockResolvedValue({ count: 1 });

    const result = await claimShopForScan("shop.test", "https://shop.test/");

    const call = updateMany.mock.calls[0][0];
    expect(call.where.OR).toContainEqual({ status: "unsupported" });
    expect(result.needsScan).toBe(true);
  });

  it("falls back to a re-read when create loses a P2002 race", async () => {
    findUnique.mockResolvedValue(null);
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const winner = { id: "shop-1", host: "shop.test", name: "Shop", status: "scanning" };
    findUniqueOrThrow.mockResolvedValue(winner);

    const result = await claimShopForScan("shop.test", "https://shop.test/");

    expect(findUniqueOrThrow).toHaveBeenCalledWith({ where: { host: "shop.test" } });
    expect(result).toEqual({ shop: winner, needsScan: false });
  });

  it("re-throws non-P2002 errors from create", async () => {
    findUnique.mockResolvedValue(null);
    create.mockRejectedValue(new Error("connection lost"));

    await expect(claimShopForScan("shop.test", "https://shop.test/")).rejects.toThrow(
      "connection lost",
    );
  });

  it("exposes the scan lease duration", () => {
    expect(SCAN_LEASE_MS).toBe(5 * 60_000);
  });
});
