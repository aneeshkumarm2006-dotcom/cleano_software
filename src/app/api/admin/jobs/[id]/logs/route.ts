import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/db";

/**
 * One page of a job's activity log.
 *
 * WHY THIS IS A ROUTE HANDLER AND NOT A SERVER ACTION.
 *
 * The pager has been through three shapes. It started as four `<a href>` full
 * page loads, which paged correctly but threw the admin back to the top of the
 * job every time. It then became `router.replace(…?logsPage=N)`, which kept the
 * scroll position but re-rendered the ENTIRE route to swap ten rows — and the
 * job detail page is expensive, so that page turn frequently never landed at
 * all and the controls read as dead.
 *
 * A server action would not have fixed it: a Next.js server action's response
 * carries a re-render of the page the caller is on, so it pays the same bill.
 * Measured on this app against a remote Postgres pooler, the action version of
 * this endpoint took ~20 SECONDS per page turn; this handler takes one query.
 *
 * The response shape is deliberately identical to the `logsData` the job page
 * serialises for its first render, so turning a page in the browser and loading
 * `?logsPage=N` fresh produce the same rows.
 */

/** Mirrors `logsPerPage` in the job detail page. */
const PER_PAGE = 10;

export interface JobLogRow {
  id: string;
  action: string;
  field: string | null;
  oldValue: string | null;
  newValue: string | null;
  description: string;
  /** ISO string — the client re-formats it. */
  createdAt: string;
  user: { id: string; name: string } | null;
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  const requested = Number(new URL(request.url).searchParams.get("page")) || 1;
  // Floor at 1 so the optimistic read below can never use a negative `skip`.
  // The upper clamp needs `total`, which arrives in the same wave — see below.
  const optimisticPage = Math.max(1, Math.floor(requested));

  // ONE wave, not three. This endpoint exists to be cheap: paying three
  // sequential round trips (session → job → logs) to fetch ten rows would have
  // put it right back in the territory that made the pager feel broken. The
  // session check and the job lookup are independent, and the log rows only
  // depend on the job for the upper page clamp — which the pager's own disabled
  // states already respect, so the optimistic read is right every time a real
  // click makes it here.
  //
  // Authorisation is still enforced before anything is RETURNED. The rows are
  // fetched concurrently with the gate, never released ahead of it.
  const [session, job, optimisticLogs] = await Promise.all([
    auth.api.getSession({ headers: await headers() }),
    db.job.findUnique({
      where: { id },
      select: { id: true, employeeId: true, _count: { select: { logs: true } } },
    }),
    db.jobLog.findMany({
      where: { jobId: id },
      include: { user: true },
      orderBy: { createdAt: "desc" },
      skip: (optimisticPage - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
  ]);

  // This endpoint is independently callable, so it repeats the job page's own
  // gate rather than trusting that the caller rendered that page.
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const role = (session.user as { role?: string }).role;
  const isAdmin = role === "OWNER" || role === "ADMIN";
  // Same rule as the page: admins see any job, anyone else only their own.
  if (!isAdmin && job.employeeId !== session.user.id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const total = job._count.logs;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
  const page = Math.min(optimisticPage, totalPages);

  // Only a request that overshot the last page pays for a second query — a
  // hand-built call asking for page 900 gets the real last page rather than an
  // empty list the UI cannot explain.
  const logs =
    page === optimisticPage
      ? optimisticLogs
      : await db.jobLog.findMany({
          where: { jobId: id },
          include: { user: true },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * PER_PAGE,
          take: PER_PAGE,
        });

  return NextResponse.json(
    {
      total,
      page,
      logs: logs.map((log) => ({
        id: log.id,
        action: log.action,
        field: log.field,
        oldValue: log.oldValue,
        newValue: log.newValue,
        description: log.description,
        createdAt: log.createdAt.toISOString(),
        user: log.user ? { id: log.user.id, name: log.user.name } : null,
      })) satisfies JobLogRow[],
    },
    // An audit trail read must never be served from a cache — a log written a
    // second ago has to show up.
    { headers: { "Cache-Control": "no-store" } }
  );
}
