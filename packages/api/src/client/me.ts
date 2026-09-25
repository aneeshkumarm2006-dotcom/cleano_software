import { MeResponse } from "../v1/me";
import type { Request } from "./request";

export const meApi = (request: Request) => ({
  me: () => request("/api/v1/me", MeResponse),
});
