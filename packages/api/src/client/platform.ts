// The platform client: the few calls made to the platform host before the app
// knows which company to talk to. No session travels on these.
import { ForgotPasswordResponse, MetaResponse, WorkspacesResponse } from "../v1/auth";
import { json, makeRequest, type ClientOptions } from "./request";

export function createPlatformClient(options: Omit<ClientOptions, "getCookie">) {
  const request = makeRequest({ ...options, getCookie: () => null });
  return {
    workspaces: (email: string, password: string) =>
      request("/api/v1/auth/workspaces", WorkspacesResponse, json("POST", { email, password })),
    forgotPassword: (email: string) =>
      request("/api/v1/auth/forgot-password", ForgotPasswordResponse, json("POST", { email })),
    meta: () => request("/api/v1/meta", MetaResponse),
  };
}

export type PlatformClient = ReturnType<typeof createPlatformClient>;
