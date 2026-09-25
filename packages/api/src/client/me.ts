import { ChangePasswordResponse, MeResponse } from "../v1/me";
import { json, type Request } from "./request";

export const meApi = (request: Request) => ({
  me: () => request("/api/v1/me", MeResponse),
  changePassword: (currentPassword: string, newPassword: string) =>
    request("/api/v1/me/password", ChangePasswordResponse, json("POST", { currentPassword, newPassword })),
});
