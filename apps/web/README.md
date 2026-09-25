# @bookmops/web

The Bookmops web product: one Next.js 16 app serving every company from its own
subdomain (`<company>.useawer.com`).

| Area | Route | Code |
|---|---|---|
| Marketing site | `/welcome` | `src/app/(marketing)` |
| Online booking | `/book` | `src/app/(book)` |
| Customer portal | `/` on a company's subdomain | `src/app/(customer)` |
| Admin console | `/admin` | `src/app/admin` |
| Cleaner portal | `/cleaners` | `src/app/cleaners` |
| Platform console (Bookmops staff) | `/console` | `src/app/console` |
| Webhooks, crons, uploads | `/api` | `src/app/api` |

Shared server logic lives in `src/lib`, UI primitives in `src/components/ui`,
and the database schema in `prisma/schema.prisma`. The design system is
catalogued in [docs/design/DESIGN-SYSTEM.md](../../docs/design/DESIGN-SYSTEM.md)
and rendered live at `/design`.

## Environment

The `.env*` files live in this folder and are never committed. Next.js picks
which ones to load by mode (`dev`, `build`, `test`); see
[its load order](https://nextjs.org/docs/app/guides/environment-variables#environment-variable-load-order).

> **Check which database a command will reach before you run it.** The Prisma
> CLI (`prisma migrate`, `prisma db push`, `prisma studio`) and any script that
> creates its own `PrismaClient` read `DATABASE_URL` from `.env`. There is no
> separate test environment behind that file by default.

## Commands

From the repository root, or from this folder without the `-w` flag:

```bash
npm run dev -w @bookmops/web
npm run build -w @bookmops/web
npm run typecheck -w @bookmops/web
npm run verify -w @bookmops/web            # every scripts/verify-*.ts
npm run verify -w @bookmops/web -- pricing  # only the ones matching "pricing"
```

Scripts in `scripts/` expect this folder as their working directory. The verify
scripts read `src/…` and `prisma/…` relative to it. Run them as
`npx tsx scripts/<name>.ts` from here.

## Deployment

Vercel project `cleano-software`, production from `main`. The project needs
two settings for this layout: **Root Directory** `apps/web`, and **Include files
outside the Root Directory in the Build Step** turned on (the Prisma engine and,
later, the shared packages live outside this folder). Crons are declared in
[vercel.json](vercel.json).
