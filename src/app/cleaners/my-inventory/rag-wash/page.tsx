import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import MyRagWashClient from "./MyRagWashClient";
import {
  RAG_PAYOUT_THRESHOLD,
  PAD_PAYOUT_THRESHOLD,
  RAG_PAYOUT_AMOUNT,
  PAD_PAYOUT_AMOUNT,
  availablePayout,
  isOverProjection,
} from "@/lib/wash";

export default async function MyRagWashPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const userId = session.user.id;

  const [user, ragWashes, recentJobs, payouts] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { ragCredits: true, padCredits: true },
    }),
    db.ragWash.findMany({
      where: { employeeId: userId },
      orderBy: { washDate: "desc" },
      take: 20,
    }),
    db.job.findMany({
      where: {
        status: "COMPLETED",
        OR: [
          { employeeId: userId },
          { cleaners: { some: { id: userId } } },
        ],
        washCreditsAwarded: true,
      },
      orderBy: { clockOutTime: "desc" },
      take: 10,
      select: {
        id: true,
        jobNumber: true,
        clientName: true,
        clockOutTime: true,
        bedCount: true,
        bathCount: true,
        jobType: true,
        washProjectedRags: true,
        washProjectedPads: true,
        washCappedRags: true,
        washCappedPads: true,
        washActualRags: true,
        washActualPads: true,
      },
    }),
    db.washPayout.findMany({
      where: { employeeId: userId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const ragCredits = user?.ragCredits ?? 0;
  const padCredits = user?.padCredits ?? 0;
  const payable = availablePayout(ragCredits, padCredits);

  const totalRags = ragWashes.reduce((sum, w) => sum + w.ragCount, 0);
  const totalPads = ragWashes.reduce((sum, w) => sum + w.padCount, 0);
  const totalWashes = ragWashes.length;
  const lastWashDate = ragWashes[0]?.washDate.toISOString() || null;

  const washes = ragWashes.map((w) => ({
    id: w.id,
    washDate: w.washDate.toISOString(),
    ragCount: w.ragCount,
    padCount: w.padCount,
    notes: w.notes,
  }));

  const jobs = recentJobs.map((j) => ({
    id: j.id,
    jobNumber: j.jobNumber,
    clientName: j.clientName,
    clockOutTime: j.clockOutTime?.toISOString() ?? null,
    bedCount: j.bedCount,
    bathCount: j.bathCount,
    jobType: j.jobType,
    projectedRags: j.washProjectedRags,
    projectedPads: j.washProjectedPads,
    cappedRags: j.washCappedRags,
    cappedPads: j.washCappedPads,
    actualRags: j.washActualRags,
    actualPads: j.washActualPads,
    flagged: isOverProjection(j.washActualRags, j.washProjectedRags),
  }));

  const payoutsDto = payouts.map((p) => ({
    id: p.id,
    amount: p.amount,
    ragCreditsUsed: p.ragCreditsUsed,
    padCreditsUsed: p.padCreditsUsed,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
  }));

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <MyRagWashClient
        employeeId={userId}
        ragCredits={ragCredits}
        padCredits={padCredits}
        payable={payable}
        thresholds={{
          rag: { credits: RAG_PAYOUT_THRESHOLD, amount: RAG_PAYOUT_AMOUNT },
          pad: { credits: PAD_PAYOUT_THRESHOLD, amount: PAD_PAYOUT_AMOUNT },
        }}
        washes={washes}
        jobs={jobs}
        payouts={payoutsDto}
        totalRags={totalRags}
        totalPads={totalPads}
        totalWashes={totalWashes}
        lastWashDate={lastWashDate}
      />
    </div>
  );
}
