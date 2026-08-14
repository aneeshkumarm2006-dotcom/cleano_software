import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  SAVED_ADDRESS_ORDER,
  SAVED_ADDRESS_SELECT,
} from "@/lib/client-address-store";
import { revalidatePath } from "next/cache";
import { getTaxRates } from "@/lib/tax.server";
import { getBookingConfig } from "@/app/(book)/actions/getBookingConfig";
import { getSetting } from "@/lib/settings";
import { getCleanerRateInputs } from "@/lib/cleaner-rates";
import { deleteJob as archiveJob } from "@/app/admin/actions/deleteJob";
import { computeJobPayShares, type JobPayInput } from "@/lib/cleaner-earnings";
import { resolveAmountDue } from "@/lib/job-billing";
import JobDetailView from "./JobDetailView";
import ScrollToTop from "./ScrollToTop";

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const logsPage = Number(search.logsPage) || 1;
  const logsPerPage = 10;

  // Everything below is fetched in PARALLEL waves, not one await after another.
  //
  // This page used to issue eleven sequential round trips (session → job →
  // users → clients → logs → photos → reviewPhotos → taxRates → bookingConfig →
  // gpsEnabled → cleaner rates). None of the middle nine depend on each other,
  // yet each waited for the one before it, so the page cost the SUM of eleven
  // latencies instead of the slowest one. Against a remote Postgres pooler
  // (~1.3s per round trip from outside the DB's region) that measured **33
  // seconds per render** — and because a Next.js server action's response
  // carries a re-render of the current page, every button on this page paid it
  // too. That is what made the logs pager look dead: its navigation could not
  // land before the sidebar's 5-second poll queued the next render behind it.
  //
  // Only two real dependencies exist, so there are only two waves:
  //   1. the job itself must exist before its participants can be priced;
  //   2. `getCleanerRateInputs` needs those participant ids.
  const [session, job] = await Promise.all([
    auth.api.getSession({ headers: await headers() }),
    db.job.findUnique({
    where: { id },
    include: {
      employee: true,
      cleaners: true,
      client: true,
      // The saved address behind this job (item 2) — city/postal/access notes
      // live there, not on the job's denormalized snapshot.
      clientAddress: {
        select: {
          label: true,
          aptNumber: true,
          city: true,
          postalCode: true,
          accessNotes: true,
        },
      },
      addOns: true,
      productUsage: {
        include: {
          product: true,
        },
      },
      ratingTokens: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      // Per-cleaner live status rows (item 9).
      assignments: true,
      // Breaks taken on this job (item 26) — the time summary shows active
      // working time, which is elapsed minus these.
      breaks: true,
      // Work sessions (round 3, item 6) — a cleaner can clock out and back in,
      // so the Team card lists every stretch rather than one pair.
      workSessions: { orderBy: { startedAt: "asc" } },
      // Manual/customer star ratings attached to this job (item 13).
      ratings: {
        include: { employee: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      },
      _count: {
        select: { logs: true },
      },
    },
    }),
  ]);

  if (!session) {
    redirect("/sign-in");
  }

  if (!job) {
    redirect("/admin/jobs");
  }

  // Check if user has access to view this job
  if (
    job.employeeId !== session.user.id &&
    (session.user as any).role !== "OWNER" &&
    (session.user as any).role !== "ADMIN"
  ) {
    redirect("/admin/jobs");
  }

  // Wave 2 — nine independent reads, issued together. `participantIds` is
  // derived from the job we already have, so the cleaner rate lookup joins this
  // wave rather than trailing it.
  const participantIds = Array.from(
    new Set(
      [job.employeeId, ...job.cleaners.map((c) => c.id)].filter(
        (uid): uid is string => !!uid
      )
    )
  );

  const [
    users,
    clients,
    logs,
    photos,
    reviewPhotos,
    taxRates,
    { addOns: addOnCatalog },
    gpsEnabled,
    rateInputs,
  ] = await Promise.all([
    // All users for the cleaner selector
    db.user.findMany({
      where: { role: { not: "CLIENT" } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        // Drives the category advisory in JobModal and the Team card (item 3).
        allowedServiceCategories: true,
      },
    }),

    db.client.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        // Fills the job form's Phone field for a linked client (item 4).
        phone: true,
        address: true,
        aptNumber: true,
        discountPercent: true,
        defaultPaymentMethodId: true,
        // The saved address book, so JobModal can offer the dropdown (item 2).
        addresses: {
          orderBy: SAVED_ADDRESS_ORDER,
          select: SAVED_ADDRESS_SELECT,
        },
      },
    }),

    // Paginated logs. The same shape the `getJobLogsPage` action returns, so a
    // page turn in the browser and a fresh load of `?logsPage=N` agree.
    db.jobLog.findMany({
      where: { jobId: id },
      include: {
        user: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      skip: (logsPage - 1) * logsPerPage,
      take: logsPerPage,
    }),

    // All photos uploaded for this job
    db.jobPhoto.findMany({
      where: { jobId: id },
      include: {
        employee: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),

    // Client-submitted review photos (attached to poor ratings)
    db.reviewPhoto.findMany({
      where: { jobId: id },
      orderBy: { createdAt: "desc" },
    }),

    // Current admin-configured GST/QST rates — used to label the tax rows and
    // to compute a display-only breakdown for older jobs saved without tax
    // amounts.
    getTaxRates(),

    // The add-on catalog, for two things: the edit modal's picker grid (which
    // had no catalog here at all, so editing a job from this page showed an
    // empty grid), and telling a catalog add-on apart from a one-off custom
    // charge.
    getBookingConfig(),

    // Live GPS tracking toggle (#10) — gates the on-the-way map below.
    getSetting("tracking.gpsEnabled"),

    // Per-cleaner pay inputs (see the pay comment below).
    getCleanerRateInputs(participantIds),
  ]);

  const totalLogs = job._count.logs;

  // Calculate total cost of products used
  const totalProductCost = job.productUsage.reduce((sum, usage) => {
    return sum + usage.quantity * usage.product.costPerUnit;
  }, 0);

  // Check if user is admin
  const isAdmin =
    (session.user as any).role === "OWNER" ||
    (session.user as any).role === "ADMIN";

  // Per-cleaner pay — computed with the EXACT function payroll and My Pay use
  // (computeJobPayShares), so the Team card, the cleaner's app, and payday can
  // never disagree. It honours the pay type (PERCENTAGE tier split vs
  // FLAT/HOURLY team-total split) and any manual per-cleaner override.
  // `participantIds` and `rateInputs` are resolved in wave 2 above.
  const shares = computeJobPayShares(job as unknown as JobPayInput, rateInputs);
  const payShares: Record<string, number> = {};
  // The job's LIVE labour cost: every participant's pay BEFORE tips. Tips are
  // customer money passed through, and the Financials net-profit formula has
  // always excluded them, so the cost figure must too.
  //
  // Deliberately NOT `job.employeePay`. On BookingKoala imports that column
  // holds the PROVIDER payment from the CSV, not the cleaner payout (see
  // src/lib/cleaner-pay-display.ts) — printing it made this page disagree with
  // payroll, My Pay and the pay modal, all of which already run
  // computeJobPayShares. It is also a save-time SNAPSHOT: it goes stale the
  // moment a rating lands or Settings → Pay Rate Multipliers is edited.
  let computedEmployeePay = 0;
  for (const [id, share] of shares) {
    payShares[id] = share.total;
    computedEmployeePay += share.base;
  }
  computedEmployeePay = Math.round(computedEmployeePay * 100) / 100;

  // Current manual overrides, so the Team card can show which cleaners have one.
  const payOverrides: Record<string, number | null> = {};
  for (const a of job.assignments) {
    payOverrides[a.cleanerId] = a.payAmount ?? null;
  }

  // Per-cleaner rows for the Financials breakdown, so the total above is never
  // a black box. `users` is already loaded for the cleaner selector — no extra
  // query.
  //
  // Stage 4b.2 — each row now carries its three components separately, because
  // the PDF asks for exactly that presentation: "base + tip share + parking
  // share = total" per cleaner. `amount` stays the BASE (the company's labour
  // cost) so the Employee-pay subtotal above it does not silently start
  // including the customer's money.
  const payRowNameById = new Map(users.map((u) => [u.id, u.name]));
  const payRows = Array.from(shares.entries()).map(([uid, share]) => ({
    cleanerId: uid,
    name: payRowNameById.get(uid) ?? "Unknown",
    amount: share.base,
    tip: share.tip,
    parking: share.parking,
    total: share.total,
    isOverride: payOverrides[uid] != null,
  }));

  // What the card would actually be charged, resolved HERE with the exact
  // function `chargeJob` calls (fix 3 item 3.2). The view used to compute its
  // own `price − discountAmount` for the Charge button, which was never the
  // billed figure in either direction: pre-tax on admin jobs (the $128/$186
  // grout job is charged $213.85) and double-discounted on web bookings.
  //
  // `giftCardCredit` mirrors chargeJob's own first step — the balance is drawn
  // down before Stripe is touched — so the button can name the card charge
  // instead of quoting a number the customer's credit will partly cover. Both
  // are display figures; chargeJob re-reads the live balance when it runs.
  const amountDue = resolveAmountDue(job);
  const giftCardCredit = Math.min(
    Math.max(0, job.client?.giftCardBalance ?? 0),
    amountDue
  );

  // TRUE when nobody is payable yet (computeJobPayShares returns an empty map:
  // no cleaners, or only an admin auto-stamped onto employeeId). The cost is
  // genuinely $0 — but the stored column may still hold an imported figure, so
  // the view surfaces it as non-authoritative rather than hiding it.
  const hasPayableParticipants = shares.size > 0;

  // ARCHIVE the job (soft delete).
  //
  // This used to be an inline `db.job.delete()` — a hard delete that destroyed
  // the row outright and took JobLog, JobAssignment, JobAssignmentInvite,
  // JobChecklist, JobAddOn, JobPhoto, JobProductUsage and the entire job chat
  // thread with it via cascade. That is the same bug documented atop
  // `actions/deleteJob.ts` (1533 rows gone on 2026-07-28), but the fix there
  // never reached this page because the Delete button used this local copy
  // instead. The confirm modal it opens is titled "Archive Job" and promises
  // "You can restore it from there" — so route through the audited action and
  // make the code keep the promise the UI makes.
  //
  // Permanent removal stays where it belongs: the Archived view's
  // `permanentlyDeleteJobs`, which is OWNER/ADMIN and archived-only.
  async function archiveJobAction() {
    "use server";

    const result = await archiveJob(id);
    // JobDetailView's handleDelete resets the modal in its catch; throwing is
    // the only way to surface a refusal (not authorized, already archived).
    if ("error" in result && result.error) {
      throw new Error(result.error);
    }

    revalidatePath("/admin/jobs");
    redirect("/admin/jobs");
  }

  // Transform data for client component
  const jobData = {
    id: job.id,
    clientName: job.clientName,
    clientId: job.clientId,
    location: job.location,
    aptNumber: job.aptNumber,
    postalCode: job.postalCode,
    clientAddressId: job.clientAddressId,
    clientAddress: job.clientAddress
      ? {
          label: job.clientAddress.label,
          aptNumber: job.clientAddress.aptNumber,
          city: job.clientAddress.city,
          postalCode: job.clientAddress.postalCode,
          accessNotes: job.clientAddress.accessNotes,
        }
      : null,
    description: job.description,
    jobType: job.jobType,
    priorityLabel: job.priorityLabel,
    jobDate: job.jobDate?.toISOString() || null,
    startTime: job.startTime.toISOString(),
    endTime: job.endTime?.toISOString() || null,
    clockInTime: job.clockInTime?.toISOString() || null,
    clockOutTime: job.clockOutTime?.toISOString() || null,
    onMyWayAt: job.onMyWayAt?.toISOString() || null,
    onMyWayLat: job.onMyWayLat ?? null,
    onMyWayLng: job.onMyWayLng ?? null,
    onMyWayLocationAt: job.onMyWayLocationAt?.toISOString() || null,
    status: job.status,
    price: job.price,
    // Both feed computeJobMoney in the view. `bookingSource` was never passed,
    // so an imported job's add-ons were rendered as if they added to its price;
    // `pricingMode` is the explicit answer that supersedes it (fix 2).
    bookingSource: job.bookingSource,
    pricingMode: job.pricingMode,
    subtotalAmount: job.subtotalAmount,
    gstAmount: job.gstAmount,
    qstAmount: job.qstAmount,
    totalAmount: job.totalAmount,
    employeePay: job.employeePay,
    // D2 — decides whether the Financials card labels the stored figure
    // "Manual amount" (and pays it) or supersedes it silently.
    employeePayIsManual: job.employeePayIsManual,
    totalTip: job.totalTip,
    parking: job.parking,
    paymentReceived: job.paymentReceived,
    isCashJob: job.isCashJob,
    taxExempt: job.taxExempt,
    discountReason: job.discountReason,
    breaks: (job.breaks ?? []).map((b: { cleanerId: string; startedAt: Date; endedAt: Date | null }) => ({
      cleanerId: b.cleanerId,
      startedAt: b.startedAt.toISOString(),
      endedAt: b.endedAt ? b.endedAt.toISOString() : null,
    })),
    workSessions: (job.workSessions ?? []).map(
      (s: { id: string; cleanerId: string; startedAt: Date; endedAt: Date | null }) => ({
        id: s.id,
        cleanerId: s.cleanerId,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt ? s.endedAt.toISOString() : null,
      })
    ),
    usesFixedPrice: job.usesFixedPrice,
    notifyClient: job.notifyClient,
    notifyProvider: job.notifyProvider,
    invoiceSent: job.invoiceSent,
    notes: job.notes,
    paymentType: job.paymentType,
    discountAmount: job.discountAmount,
    bedCount: job.bedCount,
    bathCount: job.bathCount,
    halfBathCount: job.halfBathCount,
    depositPaid: job.depositPaid,
    depositPaymentIntentId: job.depositPaymentIntentId,
    stripePaymentIntentId: job.stripePaymentIntentId,
    addOns: job.addOns.map((a) => ({
      id: a.id,
      name: a.name,
      price: a.price,
      quantity: a.quantity,
    })),
    employee: job.employee
      ? { id: job.employee.id, name: job.employee.name }
      : { id: "", name: "Unassigned" },
    cleaners: job.cleaners.map((c) => ({ id: c.id, name: c.name })),
    cancellationRequestedAt: job.cancellationRequestedAt?.toISOString() ?? null,
    rescheduleRequestedAt: job.rescheduleRequestedAt?.toISOString() ?? null,
    afterPhotoConsent: job.afterPhotoConsent,
    afterPhotoConsentAt: job.afterPhotoConsentAt?.toISOString() ?? null,
    afterPhotoConsentVersion: job.afterPhotoConsentVersion,
    afterPhotoOverrideAt: job.afterPhotoOverrideAt?.toISOString() ?? null,
    ratingTokens: job.ratingTokens.map((t) => ({
      id: t.id,
      usedAt: t.usedAt?.toISOString() ?? null,
      ratingStars: t.ratingStars,
      ratherNotAnswer: t.ratherNotAnswer,
      emailSentAt: t.emailSentAt?.toISOString() ?? null,
    })),
  };

  const productUsageData = job.productUsage.map((usage) => ({
    id: usage.id,
    quantity: usage.quantity,
    notes: usage.notes,
    product: {
      id: usage.product.id,
      name: usage.product.name,
      unit: usage.product.unit,
      costPerUnit: usage.product.costPerUnit,
    },
  }));

  const logsData = logs.map((log) => ({
    id: log.id,
    action: log.action,
    field: log.field,
    oldValue: log.oldValue,
    newValue: log.newValue,
    description: log.description,
    createdAt: log.createdAt.toISOString(),
    user: log.user ? { id: log.user.id, name: log.user.name } : null,
  }));

  const photosData = photos.map((photo) => ({
    id: photo.id,
    url: photo.url,
    caption: photo.caption,
    createdAt: photo.createdAt.toISOString(),
    employee: { id: photo.employee.id, name: photo.employee.name },
  }));

  const reviewPhotosData = reviewPhotos.map((photo) => ({
    id: photo.id,
    url: photo.url,
    rating: photo.rating,
    createdAt: photo.createdAt.toISOString(),
  }));

  // Per-cleaner assignment status rows. Jobs created before this feature have
  // none — the view derives a fallback from job-level clock fields.
  const assignmentsData = job.assignments.map((a) => ({
    cleanerId: a.cleanerId,
    status: a.status as string,
    onMyWayAt: a.onMyWayAt?.toISOString() ?? null,
    clockInTime: a.clockInTime?.toISOString() ?? null,
    clockOutTime: a.clockOutTime?.toISOString() ?? null,
  }));

  // Star ratings on this job. `ratedBy` holding a staff user id means the
  // rating was set manually by an admin (customer ratings come through the
  // review-token flow without a staff rater).
  const staffById = new Map(users.map((u) => [u.id, u.name]));
  const jobRatingsData = job.ratings.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: r.employee.name,
    rating: r.rating,
    notes: r.notes,
    raterName: r.ratedBy ? staffById.get(r.ratedBy) ?? null : null,
    createdAt: r.createdAt.toISOString(),
    // Item 5: an excluded rating stays visible here (with who pulled it and
    // why) while counting for nothing in the cleaner's score.
    excludedAt: r.excludedAt ? r.excludedAt.toISOString() : null,
    excludedByName: r.excludedById ? staffById.get(r.excludedById) ?? null : null,
    excludedReason: r.excludedReason,
  }));

  return (
    <>
      {/* Full page loads (a plain <a href>, a refresh) land wherever the
          browser left the scroller; ScrollReset only covers SPA navigation. */}
      <ScrollToTop jobId={id} />
      <JobDetailView
        job={jobData}
        productUsage={productUsageData}
        logs={logsData}
        photos={photosData}
        reviewPhotos={reviewPhotosData}
        totalLogs={totalLogs}
        logsPage={logsPage}
        logsPerPage={logsPerPage}
        totalProductCost={totalProductCost}
        taxRates={taxRates}
        amountDue={amountDue}
        giftCardCredit={giftCardCredit}
        addOnCatalog={addOnCatalog}
        isAdmin={isAdmin}
        onDeleteJob={archiveJobAction}
        users={users}
        clients={clients}
        currentUserName={session.user.name ?? undefined}
        assignments={assignmentsData}
        payShares={payShares}
        payOverrides={payOverrides}
        computedEmployeePay={computedEmployeePay}
        payRows={payRows}
        hasPayableParticipants={hasPayableParticipants}
        jobRatings={jobRatingsData}
        gpsEnabled={gpsEnabled}
      />
    </>
  );
}
