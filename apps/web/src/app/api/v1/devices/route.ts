// POST /api/v1/devices — register this phone for push notifications, for the
// caller in this company only.
import { DeviceResponse, RegisterDeviceRequest } from "@bookmops/api/v1";

import { registerDevice } from "@/server/account/devices";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: "anyStaff",
    body: RegisterDeviceRequest,
    response: DeviceResponse,
    limit: { name: "devices", max: 20, windowMs: 60 * 60_000 },
  },
  (ctx) => registerDevice(ctx.actor, ctx.body),
);
