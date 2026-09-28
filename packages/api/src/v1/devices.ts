// Push notification devices (API_V1.md §7, item 1).
import { z } from "zod";

/**
 * POST /api/v1/devices — register this phone for push notifications.
 *
 * The server must: store the token against the CALLER and their company only;
 * replace any existing row for the same token (a phone that changed hands
 * belongs to its newest signed-in person); and never send another person's
 * or another company's notifications to it.
 */
export const RegisterDeviceRequest = z.object({
  token: z.string().min(1).max(500),
  platform: z.enum(["ios", "android"]),
  appVersion: z.string().max(40),
});
export const DeviceResponse = z.object({ id: z.string() });

/**
 * POST /api/v1/devices/unregister — stop notifications to this phone, on
 * sign-out. Idempotent; the caller may only remove their own token.
 */
export const UnregisterDeviceRequest = z.object({ token: z.string().min(1).max(500) });
export const OkResponse = z.object({ ok: z.literal(true) });

/**
 * What a notification carries in its data, so a tap can open the right
 * screen. `path` is an in-app route; the app ignores anything else.
 */
export const PushData = z.object({
  path: z.string().startsWith("/").max(300).optional(),
});
