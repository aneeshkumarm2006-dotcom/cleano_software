import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-errors";
import { getJobsForDay } from "@/app/admin/actions/getJobsForDay";

export async function GET(
  _req: Request,
  context: { params: Promise<{ date: string }> }
) {
  try {
    const { date } = await context.params;
    const data = await getJobsForDay(date);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return apiError("calendar/[date]", error);
  }
}

