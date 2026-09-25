# @bookmops/core

Bookmops' business rules: the vocabularies, calculations, and validation that
define the domain. The same code runs in the web app, in both mobile apps, and
on the server.

```ts
import { isValidEmail } from "@bookmops/core/validation";
```

Each folder under `src/` is a domain, published as its own entry point
(`@bookmops/core/<domain>`) through its `index.ts`. There is no root entry, on
purpose: importing a domain shouldn't pull in all of core.

## The rule

**Core is pure.** It takes values in and gives values out. It must not reach:

- the database, the network, the file system, or environment variables;
- React, React Native, or Next.js;
- the clock or the device locale. Take `now: Date` and a locale as
  parameters. A phone's clock can be wrong, and "today" means different things
  on a phone, in a browser, and on a UTC server.

The compiler enforces the first two: `library.json` has no DOM lib and no
ambient Node types. `@bookmops/eslint-config/library` enforces the rest.
Anything that needs one of these belongs in an app, or in a package built for
that platform.

## Consuming it

Core is a just-in-time package: `exports` points straight at TypeScript source
and there is no build step. `apps/web` compiles it through `transpilePackages`,
Metro reads it directly, and `tsx` scripts import it like any other module.
