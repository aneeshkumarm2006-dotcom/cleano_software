# Bookmops

Software for running a cleaning business: online booking, scheduling, crews,
pay, inventory, invoicing, and customer messaging, for many companies from one
deployment.

| | |
|---|---|
| [`apps/web`](apps/web) | The web product: marketing site, booking, customer portal, admin console, cleaner portal, platform console. Next.js on Vercel. |
| `apps/staff` | **Bookmops Pro**, the iOS and Android app for cleaners, managers, and admins. *(planned)* |
| `apps/customer` | **Bookmops**, the iOS and Android app for customers. *(planned)* |
| [`packages/core`](packages/core) | Business rules shared by every app: pay, jobs, time, inventory, rating, services, property, validation. Pure TypeScript, enforced. |
| [`packages/typescript-config`](packages/typescript-config), [`packages/eslint-config`](packages/eslint-config) | Shared compiler and lint settings. |
| [`docs`](docs) | Architecture, product decisions, fix lists, and cutover records. |

How the repository is organised and the order it is being built in:
**[docs/architecture/MONOREPO.md](docs/architecture/MONOREPO.md)**.

## Getting started

Needs Node 22.13 or newer and npm 10.

```bash
npm install        # installs every app and package, and generates the Prisma client
npm run dev        # the web app on http://localhost:3000
```

Environment files belong to the app that reads them. The web app's live in
`apps/web/`; see [apps/web/README.md](apps/web/README.md).

## Everyday commands

Run these from the repository root:

| Command | What it does |
|---|---|
| `npm run dev` | Start the web app in development |
| `npm run build` | Production builds, in dependency order |
| `npm run typecheck` | Type-check every package |
| `npm run lint` | Lint every package |
| `npm run verify` | The code-only regression sweep (`apps/web/scripts/verify-*.ts`) |

## License

Private. All rights reserved.
