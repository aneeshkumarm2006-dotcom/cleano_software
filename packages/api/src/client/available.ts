import {
  AvailableJobDetailResponse,
  AvailableJobsResponse,
  type AvailableWhen,
  ClaimJobResponse,
} from "../v1/available";
import { json, type Request, seg } from "./request";

export const availableApi = (request: Request) => ({
  availableJobs: (when: AvailableWhen = "all", cursor?: string | null) =>
    request(
      `/api/v1/jobs/available?when=${seg(when)}${cursor ? `&cursor=${seg(cursor)}` : ""}`,
      AvailableJobsResponse,
    ),
  availableJob: (id: string) => request(`/api/v1/jobs/available/${seg(id)}`, AvailableJobDetailResponse),
  /** Claim a job. `clientEventId` is made once per confirmed tap and reused on a retry. */
  claimJob: (id: string, clientEventId: string) =>
    request(
      `/api/v1/jobs/available/${seg(id)}/claim`,
      ClaimJobResponse,
      json("POST", { clientEventId }, clientEventId),
    ),
});
