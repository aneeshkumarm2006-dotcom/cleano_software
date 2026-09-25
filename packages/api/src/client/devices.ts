import { DeviceResponse, OkResponse } from "../v1/devices";
import { json, type Request } from "./request";

export const devicesApi = (request: Request) => ({
  registerDevice: (token: string, platform: "ios" | "android", appVersion: string) =>
    request("/api/v1/devices", DeviceResponse, json("POST", { token, platform, appVersion })),
  unregisterDevice: (token: string) => request("/api/v1/devices/unregister", OkResponse, json("POST", { token })),
});
