# @bookmops/eslint-config

Shared ESLint flat configs.

| Import | For |
|---|---|
| `@bookmops/eslint-config/next` | `apps/web`: Next's core-web-vitals and TypeScript rules. |
| `@bookmops/eslint-config/library` | Platform-neutral packages such as `@bookmops/core`. It bans platform imports (Node, React, Next, Prisma), platform globals (`process`, `window`, `fetch`, `Buffer`), and implicit clock or locale reads (`new Date()`, `Date.now()`, `toLocaleString()` with no locale). |

```js
// eslint.config.mjs
import library from "@bookmops/eslint-config/library";
export default library;
```
