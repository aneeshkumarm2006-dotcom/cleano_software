import {
  ChangePasswordResponse,
  type DeletionRequestBody,
  DeletionRequestResponse,
  DeletionRequestState,
  MeResponse,
} from "../v1/me";
import { json, type Request } from "./request";

export const meApi = (request: Request) => ({
  me: () => request("/api/v1/me", MeResponse),
  changePassword: (currentPassword: string, newPassword: string) =>
    request("/api/v1/me/password", ChangePasswordResponse, json("POST", { currentPassword, newPassword })),
  /** Whether a request to delete the account is waiting for the office. */
  deletionRequest: () => request("/api/v1/me/deletion-request", DeletionRequestState),
  /** Ask the company to delete the account. A retry with the same clientEventId is the same request. */
  requestDeletion: (body: DeletionRequestBody) =>
    request("/api/v1/me/deletion-request", DeletionRequestResponse, json("POST", body, body.clientEventId)),
});
