// The typed client the mobile apps use to call /api/v1: one factory per area,
// composed here. It knows nothing about screens or state.
import { availableApi } from "./available";
import { clockApi } from "./clock";
import { devicesApi } from "./devices";
import { jobsApi } from "./jobs";
import { meApi } from "./me";
import { payApi } from "./pay";
import { photosApi } from "./photos";
import { issuesApi } from "./issues";
import { onMyWayApi } from "./on-my-way";
import { messagesApi } from "./messages";
import { announcementsApi } from "./announcements";
import { type ClientOptions, makeRequest } from "./request";

export { createPlatformClient, type PlatformClient } from "./platform";
export { ApiError, type ClientOptions, type Request } from "./request";

export function createClient(options: ClientOptions) {
  const request = makeRequest(options);
  return {
    ...meApi(request),
    ...jobsApi(request),
    ...clockApi(request),
    ...devicesApi(request),
    ...availableApi(request),
    ...payApi(request),
    ...photosApi(request),
    ...issuesApi(request),
    ...onMyWayApi(request),
    ...messagesApi(request),
    ...announcementsApi(request),
  };
}

export type ApiClient = ReturnType<typeof createClient>;
