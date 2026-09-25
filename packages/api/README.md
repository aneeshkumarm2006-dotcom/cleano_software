# @bookmops/api

The contract between the server and the mobile apps: zod schemas for every
v1 request and response, and a small typed client.

```ts
import { createClient } from "@bookmops/api/client";
import type { TodayResponse } from "@bookmops/api/v1";
```

The rules are in [docs/architecture/API_V1.md](../../docs/architecture/API_V1.md) §3.
In short: v1 only ever grows. Responses are parsed leniently (unknown fields
ignored), response enums are open (`openEnum` turns a newer value into
`UNKNOWN` instead of failing), and v1's vocabularies are frozen copies in
`src/v1/enums.ts`, never imports, so the database can't change the wire by
accident.
