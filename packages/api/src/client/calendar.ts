import { JobsListResponse } from "../v1/jobs";
import { type Request, seg } from "./request";

export const calendarApi = (request: Request) => ({
  /** The caller's jobs starting from `from` to `to` (company dates, inclusive). See v1/calendar.ts. */
  jobsBetween: (from: string, to: string, cursor?: string | null) =>
    request(
      `/api/v1/jobs?from=${seg(from)}&to=${seg(to)}${cursor ? `&cursor=${seg(cursor)}` : ""}`,
      JobsListResponse,
    ),
});
