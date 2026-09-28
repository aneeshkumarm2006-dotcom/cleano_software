// The calendar: the cleaner's own jobs over a span of dates.
//
// This is not a new resource. It is an ADDITIVE optional query on the existing
// jobs list (API_V1.md §3, "new optional request fields, provided that leaving
// one out means exactly what it meant before"):
//
//   GET /api/v1/jobs?from=YYYY-MM-DD&to=YYYY-MM-DD&cursor=…
//
// → JobsListResponse (./jobs), the same page of JobSummary the Jobs tab reads.
//
// Server:
//   - staff only; ONLY jobs the session user is assigned to, exactly the set
//     `scope=upcoming|past` draws from — never the company's schedule;
//   - a job is in the span when it STARTS on a date from `from` to `to`
//     inclusive, in the company's zone (not the server's, not the phone's);
//   - cancelled jobs are left out, as on the Jobs tab;
//   - `to` on or after `from`, at most 62 days apart (400 otherwise), which
//     covers a month view with its leading and trailing weeks;
//   - oldest first, cursor-paginated like every list;
//   - `from`/`to` and `scope` are alternatives: both → 400. A request with
//     neither `from` nor `to` behaves exactly as before.
import { z } from "zod";

import { LocalDate } from "./common";

/** The longest span one calendar request may ask for. */
export const MAX_CALENDAR_SPAN_DAYS = 62;

/** The query, for the server to validate. */
export const JobsRangeQuery = z.object({
  from: LocalDate,
  to: LocalDate,
  cursor: z.string().max(512).optional(),
});
export type JobsRangeQuery = z.infer<typeof JobsRangeQuery>;
