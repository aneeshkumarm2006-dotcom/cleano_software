// GET /api/v1/meta — the oldest and newest build of each app (API_V1.md §3).
// Any host, no session, and the one route without the version gate: it is how
// an app finds out it is too old.
import { MetaResponse } from "@bookmops/api/v1";

import { v1Route } from "@/server/v1/route";
import { appVersions } from "@/server/v1/versions";

export const dynamic = "force-dynamic";

export const GET = v1Route(
  { host: "platform", access: "public", skipVersionGate: true, response: MetaResponse },
  async () => ({ ok: true, value: { apps: appVersions() } }),
);
