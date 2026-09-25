// POST /api/v1/devices/unregister — stop notifications to this phone, on
// sign-out. Idempotent; only the caller's own token is removed.
import { OkResponse, UnregisterDeviceRequest } from "@bookmops/api/v1";

import { unregisterDevice } from "@/server/account/devices";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  { host: "tenant", access: "staff", body: UnregisterDeviceRequest, response: OkResponse },
  (ctx) => unregisterDevice(ctx.actor, ctx.body.token),
);
