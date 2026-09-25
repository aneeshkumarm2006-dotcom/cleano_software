// The typed client the mobile apps use to call /api/v1: one factory per area,
// composed here. It knows nothing about screens or state.
import { clockApi } from "./clock";
import { jobsApi } from "./jobs";
import { meApi } from "./me";
import { messagesApi } from "./messages";
import { announcementsApi } from "./announcements";
import { type ClientOptions, makeRequest } from "./request";

export { ApiError, type ClientOptions, type Request } from "./request";

export function createClient(options: ClientOptions) {
  const request = makeRequest(options);
  return {
    ...meApi(request),
    ...jobsApi(request),
    ...clockApi(request),
    ...messagesApi(request),
    ...announcementsApi(request),
  };
}

export type ApiClient = ReturnType<typeof createClient>;
