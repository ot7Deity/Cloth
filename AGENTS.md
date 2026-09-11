<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Cloth

Web app for tracking underground clothing shops. Users paste a shop URL, we snapshot the catalog, poll for changes, and show **recent new products** on the home feed (not the full catalog on first import).

## Stack

- Next.js 16 App Router, TypeScript, Tailwind
- Prisma + SQLite (`prisma/dev.db`)
- NextAuth credentials (email + password + username)

## Key paths

- `src/app/page.tsx` — home feed (recent adds)
- `src/app/shops/page.tsx` — tracked shops list
- `src/app/actions.ts` — signup, login, add/untrack shop
- `src/lib/catalog.ts` — Shopify / sitemap / HTML catalog extraction
- `src/lib/poll.ts` — sync shops, diff products
- `src/app/api/cron/poll/route.ts` — cron endpoint
- `prisma/schema.prisma` — User, Shop, Watch, Product

## Local commands

```bash
npm install
npm run db:push
npm run dev
npm run lint
npm run poll   # refresh catalogs (dev server must be running)
```

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
| `DATABASE_URL` | `file:./prisma/dev.db` |
| `AUTH_SECRET` | Random string, 32+ chars |
| `AUTH_URL` | `http://localhost:3000` on the VM |
| `CRON_SECRET` | Any secret string for `/api/cron/poll` |

After adding secrets, start a **new** cloud agent so they are injected.

### Verify your work

1. `npm run lint` and `npx tsc --noEmit`
2. Sign up at `/signup`, log in
3. Paste a Shopify shop URL on home or `/shops`, confirm products index
4. Run poll: `npm run poll` (with dev server up) or `curl "http://localhost:3000/api/cron/poll?secret=$CRON_SECRET"`
5. Confirm only **new** products (not baseline) appear on the home feed

### Product detection

1. Try `{origin}/products.json` (Shopify)
2. Fallback: sitemap product URLs
3. Fallback: HTML scrape for `/products/` links

First sync marks all products as `isBaseline: true`. Later syncs set `isBaseline: false` for genuinely new items.

### Out of scope (for now)

Email/SMS/push notifications, mobile app, social features (follow users, pickups, public profiles).

### Handoff prompt template

When switching from local to cloud before leaving your computer, paste something like:

> Continue work on Cloth (GitHub: ot7Deity/Cloth). [Describe the task]. Read AGENTS.md and `.cursor/environment.json`. Run lint and tsc before opening a PR.
