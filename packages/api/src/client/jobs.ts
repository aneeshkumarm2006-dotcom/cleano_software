import { JobDetailResponse, JobsListResponse, type JobScope, TodayResponse } from "../v1/jobs";
import { type Request, seg } from "./request";

export const jobsApi = (request: Request) => ({
  today: () => request("/api/v1/today", TodayResponse),
  jobs: (scope: JobScope, cursor?: string | null) =>
    request(`/api/v1/jobs?scope=${seg(scope)}${cursor ? `&cursor=${seg(cursor)}` : ""}`, JobsListResponse),
  job: (id: string) => request(`/api/v1/jobs/${seg(id)}`, JobDetailResponse),
});
