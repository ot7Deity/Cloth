<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Cloth

Web app for tracking underground clothing shops. Users paste a shop URL, we snapshot the catalog, poll for changes, and show **recent new products** on the home feed (not the full catalog on first import). Tracking a shop returns immediately — the catalog scan runs in the background — and a separate "Latest from {shop}" row shows recent in-stock picks right after tracking, without affecting the drops feed.

## Stack

- Next.js 16 App Router, TypeScript, Tailwind
- Prisma + Supabase Postgres (local via `supabase start`, or hosted)
- NextAuth credentials (email + password + username)
- Vitest + React Testing Library for tests

## Key paths

- `src/app/page.tsx` — home feed (recent adds) + the "Latest from {shop}" preview row
- `src/app/shops/page.tsx` — tracked shops list, status, retry/untrack
- `src/app/actions.ts` — signup, login, add/untrack/retry shop (`addShopAction` returns fast and backgrounds the scan)
- `src/app/api/shops/[id]/status/route.ts` — polled by the tracking form while a scan is in flight
- `src/app/api/cron/poll/route.ts` — sweeps stuck scans, then polls active shops
- `src/lib/catalog.ts` — Shopify / sitemap / HTML catalog extraction; captures `publishedAt`, `sourceIndex`, `inStock`; `probeCatalog` takes a time budget and reports `complete`
- `src/lib/rank.ts` — pure recency ranking (publishedAt, with a source-order-aware tiebreak)
- `src/lib/availability.ts` — bounded in-stock checks for preview candidates
- `src/lib/preview.ts` — builds the "Latest from {shop}" row (`Product.previewRank`)
- `src/lib/shop-claim.ts` — atomic compare-and-swap claim so concurrent trackers of the same shop never race or re-scan
- `src/lib/poll.ts` — `persistCatalog` (batched, not per-product), `importShop` (scan lifecycle), `sweepStuckScans`, `pollAllShops`
- `prisma/schema.prisma` — User, Shop (status/baselineAt/scanStartedAt/previewBuiltAt), Watch, Product (publishedAt/sourceIndex/inStock/previewRank)

### Shop status lifecycle

`scanning` → `active` (success) or `unsupported` (failure, message in `Shop.lastError`). A scan stuck in `scanning` past its lease (`SCAN_LEASE_MS` in `shop-claim.ts`) is resumed by the cron sweep. `Shop.baselineAt` (not a row count) is what marks a sync's first-import baseline — this must stay a completion flag, not an inference, or a resumed partial import will flood the feed with fake drops.

## Local commands

```bash
cp .env.example .env   # then fill secrets / DB URLs (or use supabase start output)
npx supabase start     # local Postgres (needs Docker)
npm install
npm run db:generate
npm run db:push
npm run dev
npm run lint
npm run test        # vitest run (single run, CI-friendly)
npm run test:watch  # vitest watch mode
npm run poll         # refresh catalogs (dev server must be running)
```

Point `DATABASE_URL` / `DIRECT_URL` at local Supabase (`supabase status`) or a hosted project (Dashboard → Connect).

## Cursor Cloud specific instructions

Cloud agents run on Ubuntu VMs. Environment config lives in [`.cursor/environment.json`](.cursor/environment.json).

### Install (runs on each Build)

```bash
npm ci && npm run db:generate && npm run db:push
```

### Dev server (terminal)

```bash
npm run dev -- --hostname 0.0.0.0 --port 3000
```

App URL on the VM: `http://localhost:3000`

### Required secrets

Add these in [Cloud Agents → Secrets](https://cursor.com/dashboard/cloud-agents) (do not commit `.env`):

| Variable | Example / notes |
| --- | --- |
| `DATABASE_URL` | Supabase pooler URL (`:6543`, `?pgbouncer=true`) |
| `DIRECT_URL` | Supabase session/direct URL (`:5432`) for Prisma migrations |
| `AUTH_SECRET` | Random string, 32+ chars |
| `AUTH_URL` | `http://localhost:3000` on the VM |
| `CRON_SECRET` | Any secret string for `/api/cron/poll` |

After adding secrets, start a **new** cloud agent so they are injected.

### Verify your work

1. `npm run lint`, `npx tsc --noEmit`, `npm run test`
2. Sign up at `/signup`, log in
3. Paste a Shopify shop URL on home or `/shops` — the form should return in under a second with a "scanning" banner, then flip to a success banner with a product count once the background scan finishes
4. Confirm the "Latest from {shop}" row shows in-stock products after the scan completes
5. Confirm only **new** products (not baseline) appear on the home drops feed — the preview row is separate and does not count as new drops
6. Run poll: `npm run poll` (with dev server up) or `curl "http://localhost:3000/api/cron/poll?secret=$CRON_SECRET"`

### Product detection

1. Try `{origin}/products.json` (Shopify) — also gives real `published_at`/`created_at` and `variants[].available`
2. Fallback: sitemap product URLs (`<lastmod>` used as a best-effort publish date)
3. Fallback: HTML scrape for `/products/` links (no date signal; ranked by page order)

First sync marks all products as `isBaseline: true`. Later syncs set `isBaseline: false` for genuinely new items. "First sync" is tracked via `Shop.baselineAt`, not a row count — see the status lifecycle note above.

### Out of scope (for now)

Email/SMS/push notifications, mobile app, social features (follow users, pickups, public profiles).

### Handoff prompt template

When switching from local to cloud before leaving your computer, paste something like:

> Continue work on Cloth (GitHub: ot7Deity/Cloth). [Describe the task]. Read AGENTS.md and `.cursor/environment.json`. Run lint and tsc before opening a PR.
