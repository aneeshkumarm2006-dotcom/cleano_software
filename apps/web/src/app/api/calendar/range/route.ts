import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-errors";
import { getJobsForRange } from "@/app/admin/actions/getJobsForDay";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One request for a whole visible span, grouped by store-timezone day.
 *
 * The month view used to call `/api/calendar/<date>` 31 times — 31 session
 * checks, 31 job queries and 31 badge passes against a 6-connection browser
 * cap. `/api/calendar/[date]` stays exactly as it was (other callers and the
 * hook's fallback still use it); this is the path `useCalendarData` takes.
 *
 * Response shape: `{ success: true, data: { "YYYY-MM-DD": Event[] } }`, where
 * each `Event` is byte-identical to an element of the per-day route's array.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json(
        { success: false, error: "start and end must be YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const data = await getJobsForRange(start, end);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return apiError("calendar/range", error);
  }
}
