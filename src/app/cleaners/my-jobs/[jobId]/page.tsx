import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { getSetting } from "@/lib/settings";
import { jobTypeLabel } from "@/lib/calendar-labels";
import { getServiceCatalogWithLabels } from "@/lib/service-catalog.server";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/time";

// Photo upload (uploadJobPhoto) runs as a server action off this page. Give it
// well beyond the default so a large HEIC photo on a slow phone connection has
// time to reach Cloudinary instead of timing out.
export const maxDuration = 90;
import {
  CLOCK_IN_BLOCKED_STATUSES,
  CLOCK_IN_EARLY_WINDOW_MIN,
  clockInOpensAt,
} from "@/lib/cleaner-jobs";
import { Calendar, Users, Package, Zap, Camera, ClipboardList, ListChecks, MapPin, DollarSign, KeyRound } from "lucide-react";
import { formatAddressLine } from "@/lib/client-address";
import { addOnQuantity } from "@/lib/job-money";
import { formatHours } from "@/lib/hourly-billing";
import { propertyTypeLabel } from "@/lib/property-type";
import { afterPhotosAllowed, photoExpectationLine } from "@/lib/job-photos";
import { ensureJobChecklist, readJobChecklist } from "@/lib/job-checklist.server";
import { CHECKLIST_NONE_CONFIGURED } from "@/lib/job-checklist";
import {
  canResume,
  sessionsFromLegacyPair,
  summariseSessions,
} from "@/lib/work-sessions";
import Link from "next/link";
import BackButton from "../BackButton";
import ClockInButton from "../ClockInButton";
import OnMyWayButton from "./OnMyWayButton";
import ClockOutButton from "../ClockOutButton";
import CancelShiftButton from "../CancelShiftButton";
import WhyThisPriceLink from "../WhyThisPriceLink";
import PhotoGallery from "./PhotoGallery";
import JobChecklistPanel from "./JobChecklistPanel";
import MapLinks from "./MapLinksClient";
import JobChatThread, {
  CLEANER_QUICK_MESSAGES,
} from "@/components/JobChatThread";
import ScrollToTop from "./ScrollToTop";
import { cleanerPayoutForJobs } from "@/lib/cleaner-pay-display";
import { isAwaitingQuote } from "@/lib/quote-status";
import { sanitizeCleanerNotes } from "@/lib/cleaner-notes";

type PageProps = {
  params: Promise<{ jobId: string }>;
};

// Local switch removed (item 20): it was a SEVENTH job-type list, understood
// only 5 legacy codes, and echoed the raw stored value for everything else — so
// a cleaner could see "MOVE_IN_OUT" on their job screen. Now uses the shared
// resolver with the admin's own service names from Settings.

function jobTypeSlug(type: string | null) {
  if (!type) return null;
  switch (type) {
    case "R": return "Residential";
    case "C": return "Commercial";
    case "PC": return "Post-Construction";
    case "F": return "Follow-up";
    default: return type.toUpperCase();
  }
}

export default async function JobDetailPage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  // Admin's own service names from Settings (item 20).
  const { labels: serviceLabels } = await getServiceCatalogWithLabels();
  if (!session) redirect("/cleanos/login");

  const { jobId } = await params;

  const job = await db.job.findUnique({
    where: { id: jobId },
    include: {
      employee: true,
      cleaners: true,
      addOns: true,
      productUsage: { include: { product: true } },
      client: { select: { phone: true, email: true } },
      // The saved address this job was booked against (item 2). `accessNotes`
      // is the point: door and gate codes live there, and without them a
      // cleaner reaches the building and cannot get in. Only reachable here —
      // the access guard below is fail-closed, so an unassigned cleaner never
      // gets this far.
      clientAddress: {
        select: {
          aptNumber: true,
          city: true,
          postalCode: true,
          accessNotes: true,
        },
      },
    },
  });

  // Fail closed: soft-deleted jobs are invisible to cleaners everywhere else,
  // so they can't be reachable by direct URL either.
  if (!job || job.deletedAt) redirect("/cleaners/my-jobs");

  const isEmployee = job.employeeId === session.user.id;
  const isCleaner = job.cleaners.some((c) => c.id === session.user.id);

  // Correct payout for THIS cleaner (base price × rating rate / manual
  // override) — never the raw employeePay column, which for imports is the
  // BookingKoala provider payment.
  const myPayout =
    (await cleanerPayoutForJobs([job.id], session.user.id)).get(job.id) ?? 0;
  if (!isEmployee && !isCleaner) redirect("/cleaners/my-jobs");

  const showCustomerPhone = await getSetting("provider.showCustomerPhone");
  const gpsEnabled = await getSetting("tracking.gpsEnabled");

  // This cleaner's kit, for the closing inventory report (Stage 3). Same shape
  // as the clock screen's, because both render the same component.
  const employeeProductsRaw = await db.employeeProduct.findMany({
    where: { employeeId: session.user.id },
    include: { product: true },
  });
  const employeeProducts = employeeProductsRaw.map((ep) => ({
    productId: ep.productId,
    name: ep.product.name,
    unit: ep.product.unit,
    quantity: ep.quantity,
    itemType: ep.product.itemType,
    levelStatus: ep.levelStatus,
    condition: ep.condition,
  }));

  const jobWithClock = job as any;

  // THIS cleaner's own sessions (item 6). Every clock gate below asks about
  // them, not about the job-level pair — that pair is shared, so it used to
  // mean one teammate's clock-in decided what everyone else could do.
  const [myWorkSessions, myBreaks] = await Promise.all([
    db.jobWorkSession.findMany({
      where: { jobId: job.id, cleanerId: session.user.id },
      orderBy: { startedAt: "asc" },
      select: { startedAt: true, endedAt: true },
    }),
    db.jobBreak.findMany({
      where: { jobId: job.id, cleanerId: session.user.id },
      select: { startedAt: true, endedAt: true },
    }),
  ]);
  const mySessions =
    myWorkSessions.length > 0
      ? myWorkSessions
      : // Legacy jobs have no session rows; their clock pair IS one session.
        sessionsFromLegacyPair(
          jobWithClock.clockInTime,
          jobWithClock.clockOutTime
        );
  const sessionSummary = summariseSessions(mySessions, myBreaks);
  /** Active minutes across every session, breaks removed. */
  const duration = sessionSummary.count > 0 ? sessionSummary.activeMinutes : null;

  // Clock gates — mirror the server guards in clockIn.ts / clockOut.ts.
  const now = new Date();
  const clockInOpens = clockInOpensAt(job.startTime);
  const hasWorkedBefore = sessionSummary.count > 0;
  // A resume isn't bound by the early window: the job has already started.
  const clockInTooEarly = !hasWorkedBefore && now.getTime() < clockInOpens.getTime();
  const canClockIn =
    !sessionSummary.isOpen &&
    !(CLOCK_IN_BLOCKED_STATUSES as readonly string[]).includes(job.status) &&
    canResume(job.status);
  const canClockOut = sessionSummary.isOpen;
  const canCancelShift =
    !hasWorkedBefore &&
    !["COMPLETED", "CANCELLED", "IN_PROGRESS", "PAID"].includes(job.status);
  const instantPayoutEligible =
    job.status === "COMPLETED" && job.paymentReceived === true && isEmployee;

  const statusSlug = job.status.toLowerCase().replace("_", "");

  // Prisma types these from the `include` above; the old `(job as any).addOns`
  // cast hid that, and the scope card added in item 12.c is a second consumer —
  // two untyped readers of the same list is one too many.
  const addOnsArr = job.addOns ?? [];

  // Item 12.a — the checklist is generated HERE, on open, for the cleaner
  // looking at the page. It used to require pressing "Generate Checklist", so a
  // cleaner who never pressed it worked the job with no checklist at all.
  //
  // Idempotent, and a no-op once the stored items still match the job, so it is
  // safe on every render. Statuses match the panel's own gate below; a job
  // that's finished keeps whatever was generated while it ran rather than
  // minting a fresh empty list. Never throws: the checklist is not worth
  // 500-ing the page over.
  //
  // CREATED is in the generate list, and that is the fix for admin-created
  // jobs. `Job.status` defaults to CREATED and `saveJob` writes no status, so
  // every job booked from the admin form sat outside this gate until clock-in
  // flipped it to IN_PROGRESS — i.e. the checklist appeared only once the
  // cleaner was already standing in the building, which is the one moment a
  // "know the requirements before you arrive" list is too late to be useful.
  // CREATED is a real state and stays one (quote-status.ts: "a quote-pending
  // job carries BOTH: status = CREATED (it is not scheduled work)"), so the
  // gate widens rather than the status being rewritten on save.
  //
  // The quote guard is NOT optional here. `quoteSettledFilter()` lives in
  // `cleanerAssignedWhere`, which every LIST query goes through — but this page
  // looks the job up by id, so an unsettled post-construction quote (status
  // CREATED, quoteStatus PENDING_REVIEW) reaches it. Without this, widening to
  // CREATED would start minting checklists for quotes nobody has accepted.
  const quoteSettled = !isAwaitingQuote(job.quoteStatus);
  const checklistState =
    isEmployee || isCleaner
      ? quoteSettled &&
        ["CREATED", "SCHEDULED", "IN_PROGRESS"].includes(job.status)
        ? await ensureJobChecklist(job.id, session.user.id)
        : await readJobChecklist(job.id, session.user.id)
      : null;
  const checklistItems = checklistState?.checklist?.items ?? [];
  const requiredItemCount = checklistItems.filter((i) => i.isRequired).length;

  // Notes are stripped of billing/price text so cleaners never see the total
  // booking value (item 10). Computed once and shared by the scope card and the
  // Notes section below.
  const safeNotes = sanitizeCleanerNotes(job.notes);
  const photosAllowed = afterPhotosAllowed(job);

  return (
    <div className="cl-jd-shell">
      <ScrollToTop jobId={job.id} />
      {/* Back */}
      <BackButton />

      {/* Hero */}
      <header className="cl-jd-hero">
        {job.location && (
          <>
            <div className="loc">
              <MapPin size={14} />
              {/* Unit + city/postal now show alongside the street (item 2).
                  The job's own snapshot wins over the saved address, because
                  the snapshot is where this job is actually being served. */}
              {formatAddressLine({
                address: job.location,
                aptNumber: job.aptNumber ?? job.clientAddress?.aptNumber ?? null,
                city: job.clientAddress?.city ?? null,
                postalCode: job.clientAddress?.postalCode ?? null,
              })}
            </div>
            {/* Map deep-links keep the raw street: adding a unit or postal code
                to the query makes Google/Apple/Waze worse at finding it. */}
            <MapLinks address={job.location} />
          </>
        )}
        {job.clientAddress?.accessNotes && (
          <div className="cl-jd-access">
            <KeyRound size={13} />
            <span>{job.clientAddress.accessNotes}</span>
          </div>
        )}
        <h1>{job.clientName}</h1>
        {jobTypeLabel(job.jobType, serviceLabels) && (
          <div className="job-type">{jobTypeLabel(job.jobType, serviceLabels)}</div>
        )}
        <div className="pills">
          <span className={`cl-pill ${statusSlug}`}>{job.status.replace("_", " ")}</span>
          {job.jobType && (
            <span className="cl-pill">{jobTypeSlug(job.jobType)}</span>
          )}
          <span className="cl-pill">JOB #{job.id.slice(-6).toUpperCase()}</span>
        </div>

        <div className="cl-jd-quick">
          {job.jobDate && (
            <div className="cl-jd-quick-tile">
              <div className="lbl">Date</div>
              <div className="val">
                {fmtDate(job.jobDate, {
                  weekday: "short", month: "short", day: "numeric",
                })}
              </div>
            </div>
          )}
          {job.startTime && (
            <div className="cl-jd-quick-tile">
              <div className="lbl">Start time</div>
              <div className="val">
                {fmtTime(job.startTime)}
              </div>
            </div>
          )}
          {(job.endTime || job.startTime) && (
            <div className="cl-jd-quick-tile">
              <div className="lbl">Est. duration</div>
              <div className="val">
                {/* On an hourly job the BILLED hours are the number that
                    matters operationally — it is what the customer booked — so
                    they win over the scheduled window when both exist. The rate
                    and the total deliberately never appear on this page: PDF #8
                    asks for hours here, and `cleaner-notes.ts` / the money rules
                    keep customer pricing off cleaner surfaces (step 8.7). */}
                {job.billingType === "HOURLY" &&
                (job.billedActualHours ?? job.billedEstimatedHours) != null
                  ? formatHours(
                      (job.billedActualHours ?? job.billedEstimatedHours) as number
                    )
                  : job.endTime && job.startTime
                    ? (() => {
                        const mins = Math.round(
                          (new Date(job.endTime).getTime() - new Date(job.startTime).getTime()) / 60000
                        );
                        return `${(mins / 60).toFixed(1)}h`;
                      })()
                    : "—"}
              </div>
              {job.billingType === "HOURLY" && (
                <div className="lbl" style={{ marginTop: 2 }}>
                  {job.billedActualHours != null
                    ? "hourly job · actual"
                    : "hourly job · booked"}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Job scope (item 12.c) — everything that defines "what am I doing
          here", in one card, above the fold and with nothing to press. The
          detail was always on the page but scattered: service type in the hero,
          add-ons two thirds of the way down, notes below that, and the checklist
          not rendered at all until somebody generated it. */}
      <div className="cl-jd-scope">
        <div className="cl-jd-card-head">
          <span className="icon-bubble">
            <ClipboardList size={20} />
          </span>
          <h3>Job scope</h3>
          <span className="head-extra">
            {requiredItemCount > 0
              ? `${requiredItemCount} required item${requiredItemCount === 1 ? "" : "s"}`
              : "No required items"}
          </span>
        </div>

        <dl className="cl-jd-dl">
          <div className="cl-jd-dl-row featured">
            <dt>Service</dt>
            <dd>{jobTypeLabel(job.jobType, serviceLabels) || "Not specified"}</dd>
          </div>
          <div className="cl-jd-dl-row">
            <dt>Checklist</dt>
            <dd>
              {checklistItems.length > 0
                ? `${checklistItems.length} item${checklistItems.length === 1 ? "" : "s"}` +
                  (requiredItemCount > 0 ? ` · ${requiredItemCount} required` : "")
                : CHECKLIST_NONE_CONFIGURED}
            </dd>
          </div>
          <div className="cl-jd-dl-row">
            <dt>Photos</dt>
            {/* The ONLY photo rule the system has is the per-job after-photo
                permission — there is no required-photo count anywhere, and a
                richer required-photos concept is deliberately NOT in scope. */}
            <dd>{photoExpectationLine(job)}</dd>
          </div>
        </dl>

        <div className="cl-jd-scope-block">
          <span className="cl-jd-scope-label">
            Add-ons{addOnsArr.length > 0 ? ` (${addOnsArr.length})` : ""}
          </span>
          <div className="cl-jd-addons">
            {addOnsArr.length === 0 ? (
              <span className="cl-jd-scope-empty">No add-ons for this job.</span>
            ) : (
              addOnsArr.map((a) => {
                // addOnQuantity, not `a.quantity ?? 1` — it clamps the legacy
                // and out-of-range rows the ?? cannot (src/lib/job-money.ts).
                const qty = addOnQuantity(a);
                return (
                  <div key={a.id} className="cl-jd-addon-chip">
                    <span className="dot" />
                    {a.name}
                    {qty > 1 ? ` ×${qty}` : ""}
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="cl-jd-scope-block">
          <span className="cl-jd-scope-label">Special instructions</span>
          <p className={`cl-jd-scope-notes${safeNotes ? "" : " empty"}`}>
            {safeNotes || "None from the client."}
          </p>
        </div>
      </div>

      {/* Instant payout banner */}
      {instantPayoutEligible && (
        <div className="cl-jd-payout-banner">
          <span className="cl-jd-payout-icon">
            <Zap size={22} />
          </span>
          <div className="cl-jd-payout-meta">
            <strong>Instant Payout Eligible</strong>
            <span>
              Payment received.{" "}
              {myPayout > 0
                ? `Request a withdrawal of $${myPayout.toFixed(2)} from My Pay.`
                : "Request a withdrawal from My Pay."}
            </span>
          </div>
          <Link href="/cleaners/my-pay" className="cl-jd-payout-btn">
            <DollarSign size={15} />
            Withdraw
          </Link>
        </div>
      )}

      {/* Time tracking */}
      {(canClockIn || canClockOut) && (
        <div className="cl-jd-track">
          <span className="cl-jd-track-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
          </span>
          <div className="cl-jd-track-meta">
            <h3>Time tracking</h3>
            <p>
              {canClockOut
                ? "Clock out when you finish the job."
                : clockInTooEarly
                  ? `Clock-in opens ${CLOCK_IN_EARLY_WINDOW_MIN / 60}h before the start — from ${fmtDateTime(clockInOpens)}.`
                  : hasWorkedBefore
                    ? // Item 6 — a finished shift is no longer the end of it.
                      `${sessionSummary.count} session${sessionSummary.count === 1 ? "" : "s"} logged. Clock back in if you need to return to this job.`
                    : "Clock in when you arrive on site to start your shift."}
            </p>
          </div>
          <div className="cl-jd-track-action">
            {/* "On my way" only makes sense before the first arrival. */}
            {canClockIn && !hasWorkedBefore && (
              <OnMyWayButton
                jobId={job.id}
                onMyWayAt={job.onMyWayAt?.toISOString() ?? null}
                gpsEnabled={gpsEnabled}
              />
            )}
            {canClockIn && (
              <ClockInButton
                jobId={job.id}
                jobStartTime={job.startTime ?? null}
                disabled={clockInTooEarly}
                resume={hasWorkedBefore}
              />
            )}
            {canClockOut && (
              <ClockOutButton
                jobId={job.id}
                employeeProducts={employeeProducts}
                checklistItems={checklistItems}
              />
            )}
          </div>
        </div>
      )}

      {/* Can't make it */}
      {canCancelShift && (
        <div className="cl-jd-cancel">
          <span className="cl-jd-cancel-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>
          <div className="cl-jd-cancel-meta">
            <strong>{"Can't make it?"}</strong>
            <span>Cancelling less than 24 hours before the shift incurs a 1-star penalty.</span>
          </div>
          <CancelShiftButton jobId={job.id} shiftStartTime={job.startTime} />
        </div>
      )}

      {/* Clocked-in time summary. Reads THIS cleaner's sessions, so a resumed
          job shows the real total instead of first-in → last-out (item 6). */}
      {sessionSummary.count > 0 && (
        <>
          <h2 className="cl-jd-section-title">Time <em>summary.</em></h2>
          <div className="cl-jd-time-summary">
            <div className="cl-jd-time-tile">
              <div className="lbl">
                {sessionSummary.count > 1 ? "First clock-in" : "Clocked in"}
              </div>
              <div className="val">
                {sessionSummary.firstStartedAt
                  ? fmtDateTime(sessionSummary.firstStartedAt)
                  : "—"}
              </div>
            </div>
            {sessionSummary.lastEndedAt && (
              <div className="cl-jd-time-tile">
                <div className="lbl">
                  {sessionSummary.count > 1 ? "Last clock-out" : "Clocked out"}
                </div>
                <div className="val">{fmtDateTime(sessionSummary.lastEndedAt)}</div>
              </div>
            )}
            {sessionSummary.count > 1 && (
              <div className="cl-jd-time-tile">
                <div className="lbl">Sessions</div>
                <div className="val">{sessionSummary.count}</div>
              </div>
            )}
            {duration != null && duration > 0 && (
              <div className="cl-jd-time-tile">
                <div className="lbl">Total worked</div>
                <div className="val">{Math.floor(duration / 60)}h {duration % 60}m</div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Job details */}
      <h2 className="cl-jd-section-title">Job <em>details.</em></h2>
      <div className="cl-jd-row">
        {/* Date & time card */}
        <div className="cl-jd-card">
          <div className="cl-jd-card-head">
            <span className="icon-bubble">
              <Calendar size={20} />
            </span>
            <h3>Date &amp; time</h3>
          </div>
          <dl className="cl-jd-dl">
            {job.jobDate && (
              <div className="cl-jd-dl-row featured">
                <dt>Job date</dt>
                <dd>
                  {fmtDate(job.jobDate, {
                    weekday: "short", month: "long", day: "numeric", year: "numeric",
                  })}
                </dd>
              </div>
            )}
            {job.startTime && (
              <div className="cl-jd-dl-row">
                <dt>Start time</dt>
                <dd>
                  {fmtTime(job.startTime)}
                </dd>
              </div>
            )}
            {job.endTime && (
              <div className="cl-jd-dl-row">
                <dt>End time</dt>
                <dd>
                  {fmtTime(job.endTime)}
                </dd>
              </div>
            )}
            {/* Hours the job is billed for (Stage 8 / PDF #8) — visible to the
                whole crew, because it is what they are expected to be on site
                for. The customer's RATE and TOTAL are deliberately absent: this
                page shows the cleaner their own pay and nothing about what the
                client is charged. */}
            {job.billingType === "HOURLY" &&
              (job.billedActualHours ?? job.billedEstimatedHours) != null && (
                <div className="cl-jd-dl-row">
                  <dt>
                    {job.billedActualHours != null
                      ? "Hours worked"
                      : "Booked hours"}
                  </dt>
                  <dd>
                    {formatHours(
                      (job.billedActualHours ?? job.billedEstimatedHours) as number
                    )}
                  </dd>
                </div>
              )}
            {isEmployee && job.payType === "HOURLY" && job.hourlyRate != null && (
              <div className="cl-jd-dl-row">
                <dt>Pay rate</dt>
                <dd>
                  ${job.hourlyRate.toFixed(2)}/hr
                  {myPayout > 0 && (
                    <span style={{ color: "var(--primary-50)", fontWeight: 400 }}>
                      {" "}· ${myPayout.toFixed(2)} est.
                    </span>
                  )}
                </dd>
              </div>
            )}
            {isEmployee &&
              job.payType !== "HOURLY" &&
              (myPayout > 0 || job.employeePay != null) && (
                <div className="cl-jd-dl-row">
                  {/* FLAT jobs show only the fixed payout — never "% of price". */}
                  <dt>{job.payType === "FLAT" ? "Pay" : "Est. pay"}</dt>
                  <dd>${myPayout.toFixed(2)}</dd>
                </div>
              )}
          </dl>
          {/* The pay-breakdown ("Why this price?") exposes the % tier math, so it
              only applies to PERCENTAGE jobs. FLAT/HOURLY show a plain amount. */}
          {isEmployee && job.payType === "PERCENTAGE" && job.employeePay != null && (
            <div style={{ marginTop: -4 }}>
              <WhyThisPriceLink jobId={job.id} />
            </div>
          )}
        </div>

        {/* Team card */}
        <div className="cl-jd-card">
          <div className="cl-jd-card-head">
            <span className="icon-bubble">
              <Users size={20} />
            </span>
            <h3>Team</h3>
            <span className="head-extra">
              {job.cleaners.length + (job.employee ? 1 : 0)} member{job.cleaners.length + (job.employee ? 1 : 0) === 1 ? "" : "s"}
            </span>
          </div>
          <div>
            <div className="cl-jd-team-row">
              <span style={{ fontSize: 12, color: "var(--primary-50)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>Lead</span>
              {job.employee ? (
                <div style={{ marginLeft: "auto", textAlign: "right" }}>
                  <div className="name">{job.employee.name}</div>
                </div>
              ) : (
                <span className="cl-pill" style={{ marginLeft: "auto", background: "var(--cream)", color: "var(--primary-50)" }}>Unassigned</span>
              )}
            </div>
            {job.cleaners.map((c: any) => (
              <div key={c.id} className="cl-jd-team-row">
                <div
                  style={{
                    width: 36, height: 36, borderRadius: "50%",
                    background: "var(--primary-10)", color: "var(--primary)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 700, flexShrink: 0,
                  }}
                >
                  {c.name?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="name">{c.name}</div>
                  <div className="role">{c.id === session.user.id ? "You · Cleaner" : "Cleaner"}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Contact Client */}
      {showCustomerPhone && (job.client?.phone || job.client?.email) && (
        <>
          <h2 className="cl-jd-section-title">Contact <em>client.</em></h2>
          <div className="cl-jd-card" style={{ marginBottom: 0 }}>
            <div className="cl-jd-card-head">
              <span className="icon-bubble">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.15 11.9 19.79 19.79 0 0 1 1.07 3.27 2 2 0 0 1 3.05 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16l.92.92z" />
                </svg>
              </span>
              <h3>Client contact</h3>
            </div>
            <dl className="cl-jd-dl">
              {job.client?.phone && (
                <div className="cl-jd-dl-row featured">
                  <dt>Phone</dt>
                  <dd>
                    <a href={`tel:${job.client.phone}`} style={{ color: "var(--primary)", textDecoration: "none", fontWeight: 600 }}>
                      {job.client.phone}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            <p style={{ fontSize: 11, color: "var(--primary-40)", margin: "8px 0 0", lineHeight: 1.5 }}>
              Use this to let the client know if you&apos;re running late or have a quick question about the job.
            </p>
          </div>
        </>
      )}

      {/* Home details */}
      {(job.bedCount != null || job.bathCount != null || job.halfBathCount != null || propertyTypeLabel(job.propertyType) || addOnsArr.length > 0) && (
        <>
          <h2 className="cl-jd-section-title">Home <em>details.</em></h2>
          <div className="cl-jd-row">
            {(job.bedCount != null || job.bathCount != null || job.halfBathCount != null || job.squareFootage || propertyTypeLabel(job.propertyType)) && (
              <div className="cl-jd-card">
                <div className="cl-jd-card-head">
                  <span className="icon-bubble">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
                    </svg>
                  </span>
                  <h3>Property size</h3>
                </div>
                <dl className="cl-jd-dl">
                  {/* PDF #11's reason for this field, in the place it applies:
                      "helps cleaners understand the job setup before arriving".
                      Leads the list — buzzer-and-elevator vs driveway-and-stairs
                      changes how you pack the car, before any room count does. */}
                  {propertyTypeLabel(job.propertyType) && (
                    <div className="cl-jd-dl-row"><dt>Property type</dt><dd>{propertyTypeLabel(job.propertyType)}</dd></div>
                  )}
                  {job.bedCount != null && (
                    <div className="cl-jd-dl-row"><dt>Bedrooms</dt><dd>{job.bedCount}</dd></div>
                  )}
                  {job.bathCount != null && (
                    <div className="cl-jd-dl-row"><dt>Full bathrooms</dt><dd>{job.bathCount}</dd></div>
                  )}
                  {job.halfBathCount != null && job.halfBathCount > 0 && (
                    <div className="cl-jd-dl-row"><dt>Half bathrooms</dt><dd>{job.halfBathCount}</dd></div>
                  )}
                  {job.squareFootage != null && job.squareFootage > 0 && (
                    <div className="cl-jd-dl-row featured"><dt>Square footage</dt><dd>{job.squareFootage} sq ft</dd></div>
                  )}
                </dl>
              </div>
            )}

            <div className="cl-jd-card">
              <div className="cl-jd-card-head">
                <span className="icon-bubble">
                  <Package size={20} />
                </span>
                <h3>Add-ons</h3>
                <span className="head-extra">
                  {addOnsArr.length} extra{addOnsArr.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="cl-jd-addons">
                {addOnsArr.length === 0 ? (
                  <span style={{ fontSize: 13, color: "var(--primary-50)" }}>No add-ons for this job.</span>
                ) : addOnsArr.map((a) => {
                  // addOnQuantity, not `a.quantity ?? 1`: this card and the
                  // scope card above must not disagree about how many, and
                  // only the helper clamps legacy/out-of-range rows.
                  const qty = addOnQuantity(a);
                  return (
                    <div key={a.id} className="cl-jd-addon-chip">
                      <span className="dot" />
                      {a.name}
                      {qty > 1 ? ` ×${qty}` : ""}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Client chat — job-specific thread with the customer */}
      <h2 className="cl-jd-section-title">Message <em>client.</em></h2>
      <div style={{ marginBottom: 8 }}>
        <JobChatThread
          jobId={job.id}
          otherLabel="Client"
          userName={session.user.name ?? undefined}
          quickMessages={CLEANER_QUICK_MESSAGES}
        />
        <p style={{ fontSize: 11, color: "var(--primary-40)", margin: "8px 0 0", lineHeight: 1.5 }}>
          Messages about this job go directly to the client. Keep it professional and job-related.
        </p>
      </div>

      {/* Notes — `safeNotes` is computed once above and shared with the scope
          card; it is stripped of any billing/price text so cleaners never see
          the total booking value (item 10). */}
      <h2 className="cl-jd-section-title">Notes</h2>
      <div className={`cl-jd-notes${!safeNotes ? " empty" : ""}`}>
        {safeNotes || "No special instructions from the client. The team will be in touch if anything changes."}
      </div>

      {/* Checklist — already generated server-side, so it renders with zero
          clicks (item 12.b: the "Generate Checklist" button is gone). */}
      {quoteSettled &&
        ["CREATED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "PAID"].includes(
          job.status
        ) && (
        <>
          <h2 className="cl-jd-section-title" id="checklist" style={{ scrollMarginTop: 80 }}>
            <ListChecks size={22} />
            Checklist
          </h2>
          <div className="cl-jd-checklist-wrap">
            <JobChecklistPanel
              items={checklistItems}
              canEdit={job.status !== "PAID"}
              stale={checklistState?.stale ?? false}
            />
          </div>
        </>
      )}

      {/* Photos */}
      {["IN_PROGRESS", "COMPLETED", "PAID"].includes(job.status) && (
        <>
          <h2 className="cl-jd-section-title" id="photos" style={{ scrollMarginTop: 80 }}>
            <Camera size={22} />
            Photos
          </h2>
          {/* Item 21: after-photos are allowed by default — no banner in the
              normal case. Only an explicitly-disabled job shows a notice. */}
          {!photosAllowed && (
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 12,
                marginBottom: 14,
                fontSize: 13.5,
                lineHeight: 1.5,
                // A neutral policy statement, not an error the cleaner caused.
                border: "1px solid #cbd5e1",
                background: "#f8fafc",
                color: "#334155",
              }}>
              <Camera size={16} style={{ flex: "0 0 auto", marginTop: 1 }} />
              <span>
                <strong>After-photos are off for this job.</strong> An admin turned
                them off, so just skip them — before-photos are all that&apos;s
                needed here.
              </span>
            </div>
          )}
          <div className="cl-jd-photos-wrap">
            <PhotoGallery
              jobId={job.id}
              canUpload={job.status !== "PAID"}
              afterPhotosAllowed={photosAllowed}
            />
          </div>
        </>
      )}

      {/* Product usage */}
      {job.productUsage.length > 0 && (
        <>
          {/* Decision D4: legacy estimated usage, kept readable. Nothing has
              written these rows since the closing inventory report shipped. */}
          <h2 className="cl-jd-section-title">Products <em>used.</em></h2>
          <div className="cl-jd-card" style={{ marginBottom: 28 }}>
            <div className="cl-jd-card-head">
              <span className="icon-bubble"><Package size={20} /></span>
              <h3>Product usage (estimated)</h3>
              <span className="head-extra">{job.productUsage.length} item{job.productUsage.length === 1 ? "" : "s"}</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--primary-10)" }}>
                    <th style={{ padding: "8px 0", textAlign: "left", color: "var(--primary-60)", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>Product</th>
                    <th style={{ padding: "8px 0", textAlign: "left", color: "var(--primary-60)", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>Qty</th>
                    {jobWithClock.clockOutTime && (
                      <>
                        <th style={{ padding: "8px 0", textAlign: "left", color: "var(--primary-60)", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>Before</th>
                        <th style={{ padding: "8px 0", textAlign: "left", color: "var(--primary-60)", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>After</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {job.productUsage.map((u: any) => (
                    <tr key={u.id} style={{ borderBottom: "1px solid var(--primary-5)" }}>
                      <td style={{ padding: "10px 0", color: "var(--ink)", fontWeight: 500 }}>{u.product.name}</td>
                      <td style={{ padding: "10px 0", color: "var(--ink)" }}>{u.quantity} {u.product.unit}</td>
                      {jobWithClock.clockOutTime && (
                        <>
                          <td style={{ padding: "10px 0", color: "var(--primary-60)" }}>{u.inventoryBefore != null ? `${u.inventoryBefore} ${u.product.unit}` : "—"}</td>
                          <td style={{ padding: "10px 0", color: "var(--primary-60)" }}>{u.inventoryAfter != null ? `${u.inventoryAfter} ${u.product.unit}` : "—"}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
