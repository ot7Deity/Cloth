"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addShopAction, unwatchAction } from "@/app/actions";

type ShopStatus = "scanning" | "active" | "unsupported";

type Banner =
  | { kind: "idle" }
  | { kind: "scanning"; shopId: string; host: string; name: string }
  | { kind: "success"; name: string; productCount: number }
  | { kind: "error"; message: string; shopId?: string; retryUrl?: string }
  | { kind: "still-scanning"; name: string };

const POLL_BACKOFF_MS = [2000, 3000, 5000, 5000, 5000, 5000, 5000, 5000];
const POLL_BUDGET_MS = 90_000;

type StatusResponse = {
  id: string;
  name: string;
  host: string;
  status: ShopStatus;
  lastError: string | null;
  productCount: number;
};

export function TrackForm() {
  const router = useRouter();
  const [banner, setBanner] = useState<Banner>({ kind: "idle" });
  const [pending, setPending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollShopIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function stopPolling() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pollShopIdRef.current = null;
  }

  function pollStatus(shopId: string, attempt: number, elapsed: number) {
    if (pollShopIdRef.current !== shopId) return;

    fetch(`/api/shops/${shopId}/status`)
      .then(async (res) => {
        if (pollShopIdRef.current !== shopId) return;
        if (!res.ok) {
          stopPolling();
          return;
        }
        let data: StatusResponse;
        try {
          data = await res.json();
        } catch {
          // Likely a redirect to /login (expired session) rendered as HTML.
          stopPolling();
          return;
        }

        if (data.status === "scanning") {
          const delay = POLL_BACKOFF_MS[Math.min(attempt, POLL_BACKOFF_MS.length - 1)];
          const nextElapsed = elapsed + delay;
          if (nextElapsed >= POLL_BUDGET_MS) {
            stopPolling();
            setBanner({ kind: "still-scanning", name: data.name });
            return;
          }
          timerRef.current = setTimeout(
            () => pollStatus(shopId, attempt + 1, nextElapsed),
            delay,
          );
          return;
        }

        stopPolling();
        if (data.status === "active") {
          setBanner({ kind: "success", name: data.name, productCount: data.productCount });
        } else {
          setBanner({
            kind: "error",
            message: data.lastError ?? "Could not read that site.",
            shopId: data.id,
          });
        }
        router.refresh();
      })
      .catch(() => {
        stopPolling();
      });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const rawUrl = String(data.get("url") ?? "").trim();

    stopPolling();
    setPending(true);
    const result = await addShopAction(data);
    setPending(false);

    if ("error" in result) {
      if (result.error) {
        setBanner({ kind: "error", message: result.error, retryUrl: rawUrl });
      }
      return;
    }

    form.reset();

    if (result.status === "scanning") {
      setBanner({ kind: "scanning", shopId: result.shopId, host: result.host, name: result.name });
      pollShopIdRef.current = result.shopId;
      pollStatus(result.shopId, 0, 0);
    } else {
      // Already scanned by an earlier watch (this or another user) — fetch
      // the current state once instead of guessing productCount.
      setBanner({ kind: "scanning", shopId: result.shopId, host: result.host, name: result.name });
      pollShopIdRef.current = result.shopId;
      pollStatus(result.shopId, POLL_BACKOFF_MS.length, 0);
    }
    router.refresh();
  }

  async function handleRetry(retryUrl: string) {
    const data = new FormData();
    data.set("url", retryUrl);
    stopPolling();
    setPending(true);
    const result = await addShopAction(data);
    setPending(false);

    if ("error" in result) {
      if (result.error) {
        setBanner({ kind: "error", message: result.error, retryUrl });
      }
      return;
    }

    setBanner({ kind: "scanning", shopId: result.shopId, host: result.host, name: result.name });
    pollShopIdRef.current = result.shopId;
    pollStatus(result.shopId, 0, 0);
    router.refresh();
  }

  async function handleUntrack(shopId: string) {
    const data = new FormData();
    data.set("shopId", shopId);
    stopPolling();
    await unwatchAction(data);
    setBanner({ kind: "idle" });
    router.refresh();
  }

  return (
    <div className="w-full space-y-3">
      <form
        className="flex w-full flex-col gap-3 sm:flex-row sm:items-start"
        onSubmit={handleSubmit}
      >
        <div className="flex-1">
          <input
            name="url"
            type="url"
            required
            placeholder="Paste a shop URL"
            className="w-full border border-white/15 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-zinc-600 focus:border-white/40"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="border border-white bg-white px-5 py-3 text-sm font-medium tracking-wide text-black uppercase disabled:opacity-50"
        >
          {pending ? "Adding…" : "Track"}
        </button>
      </form>

      {banner.kind === "scanning" ? (
        <div className="flex items-center gap-2 border border-white/25 bg-white/[0.03] px-4 py-3 text-sm text-zinc-300">
          <span className="h-2 w-2 animate-pulse rounded-full bg-white/60" />
          Scanning {banner.host}… we&rsquo;ll show the latest drops in a moment.
        </div>
      ) : null}

      {banner.kind === "still-scanning" ? (
        <div className="border border-white/25 bg-white/[0.03] px-4 py-3 text-sm text-zinc-300">
          Still scanning {banner.name} — it has a big catalog. It&rsquo;ll appear on its own; check
          back in a minute.
        </div>
      ) : null}

      {banner.kind === "success" ? (
        <div className="border border-emerald-500/40 bg-emerald-500/[0.05] px-4 py-3 text-sm text-emerald-300">
          Now tracking {banner.name} — {banner.productCount} products indexed. Latest picks below.
        </div>
      ) : null}

      {banner.kind === "error" ? (
        <div className="flex flex-wrap items-center gap-3 border border-red-500/40 bg-red-500/[0.05] px-4 py-3 text-sm text-red-400">
          <span>{banner.message}</span>
          {banner.retryUrl ? (
            <button
              type="button"
              onClick={() => handleRetry(banner.retryUrl!)}
              className="text-red-300 underline hover:text-red-200"
            >
              Retry
            </button>
          ) : null}
          {banner.shopId ? (
            <button
              type="button"
              onClick={() => handleUntrack(banner.shopId!)}
              className="text-red-300 underline hover:text-red-200"
            >
              Untrack
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
