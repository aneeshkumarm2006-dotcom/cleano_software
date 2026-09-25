// The typed client the mobile apps use to call /api/v1: one factory per area,
// composed here. It knows nothing about screens or state.
import { availabilityApi } from "./availability";
import { calendarApi } from "./calendar";
import { clockApi } from "./clock";
import { documentsApi } from "./documents";
import { jobsApi } from "./jobs";
import { kitApi } from "./kit";
import { meApi } from "./me";
import { type ClientOptions, makeRequest } from "./request";
import { strikesApi } from "./strikes";
import { trainingApi } from "./training";

export { ApiError, type ClientOptions, type Request } from "./request";

export function createClient(options: ClientOptions) {
  const request = makeRequest(options);
  return {
    ...meApi(request),
    ...jobsApi(request),
    ...clockApi(request),
    ...kitApi(request),
    ...availabilityApi(request),
    ...calendarApi(request),
    ...trainingApi(request),
    ...documentsApi(request),
    ...strikesApi(request),
  };
}

export type ApiClient = ReturnType<typeof createClient>;
