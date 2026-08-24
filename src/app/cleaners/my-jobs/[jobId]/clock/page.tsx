import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/org-db";
import { getSetting } from "@/lib/settings";
import ClockPageClient from "./ClockPageClient";

type PageProps = { params: Promise<{ jobId: string }> };

export default async function ClockPage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/cleanos/login");

  const { jobId } = await params;

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { cleaners: { select: { id: true } } },
  });

  if (!job) redirect("/cleaners/my-jobs");

  const isEmployee = job.employeeId === session.user.id;
  const isCleaner = (job as any).cleaners?.some((c: any) => c.id === session.user.id);
  if (!isEmployee && !isCleaner) redirect("/cleaners/my-jobs");

  // This cleaner's kit, for the closing inventory report (Stage 3). `itemType`
  // decides which vocabulary each row is reported in, and the stored
  // level/condition is shown as "what we already believe" beside it — the rows
  // themselves start blank so only what the cleaner touches is submitted.
  const rawProducts = await db.employeeProduct.findMany({
    where: { employeeId: session.user.id },
    include: { product: true },
  });

  const employeeProducts = rawProducts.map((ep) => ({
    productId: ep.productId,
    name: ep.product.name,
    unit: ep.product.unit,
    quantity: ep.quantity,
    itemType: ep.product.itemType,
    levelStatus: ep.levelStatus,
    condition: ep.condition,
  }));

  const j = job as any;

  const gpsEnabled = await getSetting("tracking.gpsEnabled");

  // Is a break already running? Read server-side so reloading mid-break keeps
  // the button in the right state (item 26).
  const runningBreak = await db.jobBreak.findFirst({
    where: { jobId: job.id, cleanerId: session.user.id, endedAt: null },
    select: { id: true },
  });
  const onBreak = !!runningBreak;

  // This cleaner's own work sessions and breaks (item 6). The session log used
  // to be a three-way ternary over the single clock pair, so it could render at
  // most one row no matter how many times the cleaner had been on site.
  const [mySessions, myBreaks] = await Promise.all([
    db.jobWorkSession.findMany({
      where: { jobId: job.id, cleanerId: session.user.id },
      orderBy: { startedAt: "asc" },
      select: { id: true, startedAt: true, endedAt: true },
    }),
    db.jobBreak.findMany({
      where: { jobId: job.id, cleanerId: session.user.id },
      select: { startedAt: true, endedAt: true },
    }),
  ]);

  return (
    <ClockPageClient
      jobId={job.id}
      clientName={job.clientName}
      startTime={job.startTime?.toISOString() ?? null}
      endTime={job.endTime?.toISOString() ?? null}
      status={job.status}
      clockInTime={j.clockInTime?.toISOString() ?? null}
      clockOutTime={j.clockOutTime?.toISOString() ?? null}
      initialOnBreak={onBreak}
      onMyWayAt={j.onMyWayAt?.toISOString() ?? null}
      employeeProducts={employeeProducts}
      gpsEnabled={gpsEnabled}
      sessions={mySessions.map((s) => ({
        id: s.id,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt?.toISOString() ?? null,
      }))}
      breaks={myBreaks.map((b) => ({
        startedAt: b.startedAt.toISOString(),
        endedAt: b.endedAt?.toISOString() ?? null,
      }))}
    />
  );
}
