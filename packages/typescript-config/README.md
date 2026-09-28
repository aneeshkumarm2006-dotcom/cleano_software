# @bookmops/typescript-config

Shared `tsconfig` bases. Each app and package extends one and adds only what is
its own (`paths`, `include`).

| File | For | Notes |
|---|---|---|
| `base.json` | everything | Strict mode, bundler resolution, no emit. |
| `nextjs.json` | `apps/web` | DOM libs, JSX, the Next.js plugin. |
| `library.json` | platform-neutral packages such as `@bookmops/core` | No DOM lib and no ambient types, so `window`, `document`, `process`, and `Buffer` don't exist as far as the compiler is concerned. That's how "runs the same in a browser, on a phone, and on the server" is enforced rather than hoped for. |

A React Native base arrives with the first Expo app.
