import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import BookingsClient from "./BookingsClient";
import CancelRecurringCard from "../../CancelRecurringCard";
import { RECURRING_FREQUENCIES } from "@/lib/retention-constants";

const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every 2 weeks",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
};

export default async function BookingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const email = session.user.email?.toLowerCase();
  const client = email
    ? await db.client.findFirst({ where: { email } })
    : null;

  if (!client) {
    return (
      <div className="rounded-2xl bg-white border border-[#008C9C]/10 p-8 text-center text-sm text-[#008C9C]/70">
        We can't find any bookings linked to your email.
      </div>
    );
  }

  const jobs = await db.job.findMany({
    // Archived bookings are gone from the customer's history (item 1).
    where: { clientId: client.id, deletedAt: null },
    orderBy: { startTime: "desc" },
    take: 100,
    include: {
      cleaners: { select: { id: true, name: true } },
      addOns: { select: { name: true, price: true, quantity: true } },
    },
  });

  // Count how many siblings each parent has (for "Part of X-visit series" label)
  const parentIds = jobs
    .map((j) => j.parentJobId)
    .filter((id): id is string => !!id);
  const parentCounts = new Map<string, number>();
  for (const id of parentIds) {
    parentCounts.set(id, (parentCounts.get(id) ?? 0) + 1);
  }

  const serialized = jobs.map((j) => {
    const isRecurringParent = !j.parentJobId && parentCounts.has(j.id);
    const seriesSize = j.parentJobId
      ? (parentCounts.get(j.parentJobId) ?? 0) + 1
      : isRecurringParent
      ? (parentCounts.get(j.id) ?? 0) + 1
      : 0;

    return {
      id: j.id,
      jobNumber: j.jobNumber,
      startTime: j.startTime.toISOString(),
      status: j.status,
      isFlexible: j.isFlexible,
      location: j.location,
      jobType: j.jobType,
      price: j.price,
      paidAt: j.paidAt?.toISOString() ?? null,
      paymentReceived: j.paymentReceived,
      refundedAmount: j.refundedAmount,
      depositPaid: j.depositPaid,
      depositPaidAt: j.depositPaidAt?.toISOString() ?? null,
      cancellationRequestedAt:
        j.cancellationRequestedAt?.toISOString() ?? null,
      rescheduleRequestedAt: j.rescheduleRequestedAt?.toISOString() ?? null,
      cleaners: j.cleaners,
      addOns: j.addOns,
      parentJobId: j.parentJobId,
      seriesSize,
    };
  });

  const isRecurringClient =
    !!client.serviceFrequency &&
    (RECURRING_FREQUENCIES as readonly string[]).includes(client.serviceFrequency);

  return (
    <>
      <BookingsClient bookings={serialized} />
      {isRecurringClient && (
        <CancelRecurringCard
          frequencyLabel={
            FREQUENCY_LABELS[client.serviceFrequency as string] ?? "recurring"
          }
        />
      )}
    </>
  );
}
