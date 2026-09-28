# @bookmops/eslint-config

Shared ESLint flat configs.

| Import | For |
|---|---|
| `@bookmops/eslint-config/next` | `apps/web`: Next's core-web-vitals and TypeScript rules. |
| `@bookmops/eslint-config/library` | Platform-neutral packages such as `@bookmops/core`. It bans platform imports (Node, React, Next, Prisma), platform globals (`process`, `window`, `self`, `fetch`, `Buffer`, `crypto`, the timers, and anything reached through `globalThis`), and implicit clock, zone, or locale reads (`new Date()`, `Date.now()`, local-time `new Date(y, m, d)`, and `toLocale*()` or `Intl.*()` with no locale). |

```js
// eslint.config.mjs
import library from "@bookmops/eslint-config/library";
export default library;
```
