"use client";

import { useState } from "react";
import { addShopAction } from "@/app/actions";

export function TrackForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="flex w-full flex-col gap-3 sm:flex-row sm:items-start"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        setMessage(null);
        const form = event.currentTarget;
        const data = new FormData(form);
        const result = await addShopAction(data);
        setPending(false);
        if (result && "error" in result && result.error) {
          setError(result.error);
          return;
        }
        if (result && "ok" in result) {
          setMessage(
            `Tracking ${result.name} — ${result.count} products indexed. New drops will show here.`,
          );
          form.reset();
        }
      }}
    >
      <div className="flex-1">
        <input
          name="url"
          type="url"
          required
          placeholder="Paste a shop URL"
          className="w-full border border-white/15 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-zinc-600 focus:border-white/40"
        />
        {error ? <p className="mt-2 text-sm text-red-400">{error}</p> : null}
        {message ? <p className="mt-2 text-sm text-zinc-400">{message}</p> : null}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="border border-white bg-white px-5 py-3 text-sm font-medium tracking-wide text-black uppercase disabled:opacity-50"
      >
        {pending ? "Reading site…" : "Track"}
      </button>
    </form>
  );
}
