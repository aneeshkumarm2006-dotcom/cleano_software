import { NextResponse } from "next/server";
import { getJobsForDay } from "@/app/(app)/actions/getJobsForDay";

export async function GET(
  _req: Request,
  context: { params: Promise<{ date: string }> }
) {
  try {
    const { date } = await context.params;
    const data = await getJobsForDay(date);
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to load calendar" },
      { status: 500 }
    );
  }
}

