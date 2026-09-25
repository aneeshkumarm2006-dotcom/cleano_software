import type { DataSource } from "../source";
import { delay } from "./delay";

/** Sample-data mode registers no device: there is no server to notify it. */
export const previewDevicesApi = {
  registerDevice: () => delay({ id: "preview-device" }),
  unregisterDevice: () => delay({ ok: true as const }),
} satisfies Pick<DataSource, "registerDevice" | "unregisterDevice">;
