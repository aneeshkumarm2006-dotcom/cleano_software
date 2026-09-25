// The typed client the mobile apps use to call /api/v1: one factory per area,
// composed here. It knows nothing about screens or state.
import { clockApi } from "./clock";
import { jobsApi } from "./jobs";
import { meApi } from "./me";
import { type ClientOptions, makeRequest } from "./request";

export { createPlatformClient, type PlatformClient } from "./platform";
export { ApiError, type ClientOptions, type Request } from "./request";

export function createClient(options: ClientOptions) {
  const request = makeRequest(options);
  return {
    ...meApi(request),
    ...jobsApi(request),
    ...clockApi(request),
  };
}

export type ApiClient = ReturnType<typeof createClient>;
