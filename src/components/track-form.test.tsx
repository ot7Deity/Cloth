// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrackForm } from "@/components/track-form";

const addShopAction = vi.fn();
const unwatchAction = vi.fn();
const refresh = vi.fn();

vi.mock("@/app/actions", () => ({
  addShopAction: (...a: unknown[]) => addShopAction(...a),
  unwatchAction: (...a: unknown[]) => unwatchAction(...a),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

function fillAndSubmit(url = "https://shop.test") {
  fireEvent.change(screen.getByPlaceholderText("Paste a shop URL"), {
    target: { value: url },
  });
  fireEvent.submit(screen.getByPlaceholderText("Paste a shop URL").closest("form")!);
}

beforeEach(() => {
  addShopAction.mockReset();
  unwatchAction.mockReset();
  refresh.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})), // never resolves unless a test overrides it
  );
});

describe("TrackForm", () => {
  it("shows the error banner when the action returns an error", async () => {
    addShopAction.mockResolvedValue({ error: "That does not look like a valid URL." });

    render(<TrackForm />);
    fillAndSubmit();

    expect(await screen.findByText("That does not look like a valid URL.")).toBeInTheDocument();
  });

  it("shows the scanning banner immediately after a submit that needs a scan", async () => {
    addShopAction.mockResolvedValue({
      ok: true,
      shopId: "shop-1",
      host: "shop.test",
      name: "Shop Test",
      status: "scanning",
    });

    render(<TrackForm />);
    fillAndSubmit();

    expect(await screen.findByText(/Scanning shop\.test/)).toBeInTheDocument();
  });

  it("shows the success banner once the status check reports active", async () => {
    addShopAction.mockResolvedValue({
      ok: true,
      shopId: "shop-1",
      host: "shop.test",
      name: "Shop Test",
      status: "active",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          id: "shop-1",
          name: "Shop Test",
          host: "shop.test",
          status: "active",
          lastError: null,
          productCount: 12,
        }),
      })),
    );

    render(<TrackForm />);
    fillAndSubmit();

    expect(
      await screen.findByText(/Now tracking Shop Test — 12 products indexed/),
    ).toBeInTheDocument();
  });

  it("shows a retry/untrack error banner when the status check reports unsupported", async () => {
    addShopAction.mockResolvedValue({
      ok: true,
      shopId: "shop-1",
      host: "shop.test",
      name: "Shop Test",
      status: "scanning",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          id: "shop-1",
          name: "Shop Test",
          host: "shop.test",
          status: "unsupported",
          lastError: "Could not find a product catalog on this site.",
          productCount: 0,
        }),
      })),
    );

    render(<TrackForm />);
    fillAndSubmit();

    expect(
      await screen.findByText("Could not find a product catalog on this site."),
    ).toBeInTheDocument();
    expect(screen.getByText("Untrack")).toBeInTheDocument();
  });
});
