import { NextResponse } from "next/server";

/**
 * Turning a thrown error into an honest HTTP response.
 *
 * Two problems this fixes, both in the calendar routes and both easy to repeat.
 *
 * The first is the status. A `catch` that returns 500 for everything reports
 * "you are not signed in" and "that date range is too wide" as server faults.
 * The caller cannot tell a refusal from a breakage, and monitoring fills with
 * 500s that are working-as-intended — which is how a real incident gets missed.
 *
 * The second is the body. `error.message` was echoed back verbatim. Today those
 * messages are ours and harmless. The one that matters is the one nobody
 * planned for: a Prisma failure carries table names, column names and
 * constraint names, and this would have handed them to an anonymous caller.
 *
 * So: errors we RAISED ON PURPOSE are matched by message and answered
 * precisely. Everything else gets a generic 500, and the detail goes to the
 * server log where it belongs.
 */

const REFUSALS: [RegExp, number][] = [
  [/^unauthori[sz]ed$/i, 401],
  [/^not authori[sz]ed$/i, 403],
  [/^forbidden$/i, 403],
  [/^not found$/i, 404],
  [/^invalid (date|range)$/i, 400],
  [/^range too large$/i, 400],
];

export function apiError(where: string, error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : String(error);

  for (const [pattern, status] of REFUSALS) {
    if (pattern.test(message.trim())) {
      return NextResponse.json({ success: false, error: message }, { status });
    }
  }

  // Unrecognised: the caller learns nothing, the log learns everything.
  console.error(`${where}:`, error);
  return NextResponse.json(
    { success: false, error: "Something went wrong. Please try again." },
    { status: 500 },
  );
}
