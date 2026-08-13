import { NextResponse } from "next/server";
import { getAdminAttentionCounts } from "@/app/admin/actions/getAdminAttentionCounts";

/**
 * Every sidebar attention badge in one round trip.
 *
 * A `GET` handler rather than the server action it used to be: an action's
 * response carries an RSC re-render of the route the caller is standing on, so
 * a sidebar poll mounted on EVERY admin page was restarting the render of
 * whatever the admin was looking at — see src/lib/chatUnread.ts for the full
 * write-up and the measurements.
 *
 * Role gating still lives in `getAdminAttentionCounts` (non-admins and
 * anonymous callers get zeroes), so this endpoint discloses nothing the action
 * didn't.
 */
export async function GET() {
  const data = await getAdminAttentionCounts();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store, private" },
  });
}
