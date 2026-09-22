// Sept 17 fix list. Behaviour first, wiring second.
//
// Items 1 to 6, 10 to 12 and 14 to 17 are the Sept 10 list again and are
// covered by scripts/verify-sept10-fixes.ts. This file covers what is new.
import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_TAX_RATES,
  calculateTax,
  computeJobTaxes,
  taxLines,
  type TaxRates,
} from "../src/lib/tax";
import {
  maxReachableStep,
  stepBlockers,
  stepRequirementsMet,
} from "../src/app/(book)/book/blockers";
import type { BookingDraft } from "../src/app/(book)/book/types";
import {
  CHECKLIST_TIER_LABEL,
} from "../src/lib/checklist-triggers";
import {
  CUSTOM_CHECKLIST_MAX_ITEMS,
  parseCustomChecklist,
} from "../src/lib/job-checklist";
import {
  hourlyClockedHours,
  hourlyTeamPayFromClock,
} from "../src/lib/cleaner-earnings";
import { SERIES_PROPAGATED_FIELDS } from "../src/lib/job-series";
import {
  isInternalNote,
  normaliseAdminRating,
  ratingSource,
} from "../src/lib/rating-history";
import {
  canDecide,
  checkTimeLogRequest,
  TIME_LOG_REQUEST_WINDOW_DAYS,
} from "../src/lib/time-log-requests";


let pass = 0,
  fail = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) {
    console.log(`        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    fail++;
  } else pass++;
}


/** Does any file under `dir` contain `needle`? */
function read_dir_has(dir: string, needle: string): boolean {
  const stack = [path.join(process.cwd(), dir)];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.(ts|tsx|css)$/.test(entry.name)) {
        if (fs.readFileSync(full, "utf8").includes(needle)) return true;
      }
    }
  }
  return false;
}

const read = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf8");

// ═══════════════════════════════════════════════════════════════════════════
// Item 7 — Calgary bookings charging QST
// ═══════════════════════════════════════════════════════════════════════════
//
// The reported symptom is a display one ("Calgary booking page still shows
// QST"), but the arithmetic behind it was wrong too: the public booking page
// AND `computeBookingPrice` both read Quebec's statutory constants, so an
// Alberta customer was QUOTED and CHARGED 9.975% provincial tax.

const MONTREAL: TaxRates = { gstRate: 5, qstRate: 9.975 };
const CALGARY: TaxRates = { gstRate: 5, qstRate: 0 };

// ── The reported booking, to the cent ──────────────────────────────────────
//
// $148.00 base, from the screenshot. Montreal's total was $170.16, which is
// what Calgary was being shown.
const montreal = calculateTax(148, MONTREAL);
check("Montreal still charges both taxes", [montreal.gstAmount, montreal.qstAmount], [7.4, 14.76]);
check("...for the total the screenshot shows", montreal.total, 170.16);

const calgary = calculateTax(148, CALGARY);
check("Calgary charges GST only", [calgary.gstAmount, calgary.qstAmount], [7.4, 0]);
check("...so the customer pays $14.76 less", calgary.total, 155.4);

// ── And the row disappears, rather than reading $0.00 ──────────────────────
check(
  "Montreal shows both rows, named from its own rates",
  taxLines(MONTREAL, montreal).map((l) => l.label),
  ["GST (5%)", "QST (9.975%)"]
);
check(
  "Calgary shows GST alone",
  taxLines(CALGARY, calgary).map((l) => l.label),
  ["GST (5%)"]
);
check(
  "...and the amount on it is the right one",
  taxLines(CALGARY, calgary).map((l) => l.amount),
  [7.4]
);

// A workspace that charges nothing at all gets no tax section.
check("a tax-free workspace shows no rows", taxLines({ gstRate: 0, qstRate: 0 }, calgary), []);

// The rate is READ, not typed. A workspace on some other rate must see it.
check(
  "a rate nobody hardcoded still prints correctly",
  taxLines({ gstRate: 13, qstRate: 0 }, { gstAmount: 19.24, qstAmount: 0 })[0].label,
  "GST (13%)"
);
check(
  "...and a fractional one keeps its decimals without trailing zeros",
  taxLines({ gstRate: 9.975, qstRate: 0 }, { gstAmount: 0, qstAmount: 0 })[0].label,
  "GST (9.975%)"
);

// ── One rounding rule, not two ─────────────────────────────────────────────
//
// `calculateTax` (bookings) and `computeJobTaxes` (jobs, invoices, receipts)
// were separate implementations of the same arithmetic. A booking that rounded
// one way became a job that rounded the other.
const awkward = 149.99;
const viaBooking = calculateTax(awkward, MONTREAL);
const viaJob = computeJobTaxes(awkward, MONTREAL, false);
check(
  "a booking and the job it becomes round identically",
  [viaBooking.gstAmount, viaBooking.qstAmount, viaBooking.total],
  [viaJob.gstAmount, viaJob.qstAmount, viaJob.totalAmount]
);

// An exempt job is still zero at any rates.
check(
  "tax exemption beats the rates",
  computeJobTaxes(148, MONTREAL, true).totalAmount,
  148
);

// ── Wiring: nothing may reach the Quebec constants by accident ─────────────
check(
  "the booking page asks the server for this workspace's rates",
  read("src/app/(book)/actions/getBookingConfig.ts").includes("getTaxRates()"),
  true
);
check(
  "what the customer is CHARGED uses them too",
  read("src/lib/booking-pricing.ts").includes("calculateTax(preTax, await getTaxRates())"),
  true
);
check(
  "the review step takes the rates as a required prop",
  read("src/app/(book)/book/steps/Step5Review.tsx").includes("taxRates: TaxRates;"),
  true
);
check(
  "...and the page never seeds it with the Quebec defaults",
  read("src/app/(book)/book/page.tsx").includes("useState<TaxRates | null>(null)"),
  true
);

// The rates must be a required argument. A default is how this bug survived:
// every forgetful call site went on charging Quebec's rates and looked correct
// in Montreal.
check(
  "calculateTax cannot be called without rates",
  /export function calculateTax\(subtotal: number, rates: TaxRates\)/.test(read("src/lib/tax.ts")),
  true
);

// No surface may name a rate it did not read.
const RATE_LABEL_FILES = [
  "src/lib/email.ts",
  "src/lib/receipt-pdf.ts",
  "src/app/(book)/book/steps/Step5Review.tsx",
  "src/app/(customer)/(secured)/bookings/[id]/page.tsx",
  "src/app/admin/jobs/JobModal.tsx",
  "src/app/admin/jobs/[id]/JobDetailView.tsx",
  "src/app/admin/invoices/InvoicePreview.tsx",
  "src/app/admin/invoices/CreateInvoiceModal.tsx",
];
for (const file of RATE_LABEL_FILES) {
  check(
    `${file} does not print a hardcoded tax rate`,
    /["'`]\s*(GST \(5%\)|QST \(9\.975%\))/.test(read(file)),
    false
  );
}

check(
  "the Quebec seed lives in one place",
  [DEFAULT_TAX_RATES.gstRate, DEFAULT_TAX_RATES.qstRate],
  [5, 9.975]
);
for (const file of [
  "src/app/admin/invoices/page.tsx",
  "src/app/admin/invoices/[id]/page.tsx",
  "src/app/admin/actions/createInvoice.ts",
  "src/app/admin/actions/updateInvoice.ts",
  "src/app/admin/actions/generateInvoiceFromJob.ts",
  "src/app/admin/finances/page.tsx",
]) {
  check(`${file} falls back to that seed, not a literal`, /\?\?\s*9\.975/.test(read(file)), false);
}

// ═══════════════════════════════════════════════════════════════════════════
// Item 9 — Confirm booking greyed out with no explanation
// ═══════════════════════════════════════════════════════════════════════════

const DRAFT: BookingDraft = {
  ...(JSON.parse(
    JSON.stringify({
      postalCode: "T2N 0H2",
      postalCovered: true,
      address: "2304 2 Ave NW",
      aptNumber: "",
      serviceType: "STANDARD",
      frequency: "ONE_TIME",
      propertyType: "HOUSE",
      bedCount: 1,
      bathCount: 1,
      halfBathCount: 0,
      squareFootage: 0,
      photos: [],
      addOns: [],
      date: "2026-09-22",
      timeSlot: "09:00",
      isFlexible: false,
      timeSlotValid: true,
      name: "Prem Sai",
      email: "prem@example.com",
      phone: "5145550123",
      notes: "",
      travelFee: 0,
      promoCode: "",
      promoApplied: false,
      promoDiscount: 0,
      afterPhotoConsent: false,
      smsConsent: false,
      stripeCardReady: false,
      depositWaived: false,
      stripeCustomerId: "",
    })
  ) as BookingDraft),
};

const REVIEW = 4;

// ── The reported state, exactly ────────────────────────────────────────────
//
// "Required consent boxes are checked, but Confirm booking still appears
// greyed out." Both consent boxes ticked is `agree: true`; the card is what is
// actually missing, and the page said nothing about it.
check(
  "terms ticked, no card: still blocked, and it says why",
  stepBlockers(REVIEW, DRAFT, true).map((b) => b.field),
  ["card"]
);
check(
  "...in words a customer can act on",
  stepBlockers(REVIEW, DRAFT, true)[0].message,
  "Finish entering your card details for the deposit."
);

check(
  "card ready, terms not ticked: the other way round",
  stepBlockers(REVIEW, { ...DRAFT, stripeCardReady: true }, false).map((b) => b.field),
  ["terms"]
);
check(
  "neither: both are named, terms first because it is higher on the page",
  stepBlockers(REVIEW, DRAFT, false).map((b) => b.field),
  ["terms", "card"]
);

// ── The button goes live the moment the last thing is done ─────────────────
check(
  "terms + card clears it",
  stepRequirementsMet(REVIEW, { ...DRAFT, stripeCardReady: true }, true),
  true
);
check(
  "and a waived deposit needs no card at all",
  stepRequirementsMet(REVIEW, { ...DRAFT, depositWaived: true }, true),
  true
);
check(
  "...which is the one case a card-less booking is allowed",
  stepBlockers(REVIEW, { ...DRAFT, depositWaived: true }, true),
  []
);

// ── Nothing may block without a reason ─────────────────────────────────────
//
// The point of the whole item. Whatever state the draft is in, "blocked" and
// "has something to say about it" must be the same answer — otherwise the
// customer is back to staring at a grey button.
const STATES: [string, Partial<BookingDraft>, boolean][] = [
  ["empty draft", { postalCovered: false, address: "", serviceType: "", name: "", email: "", phone: "" }, false],
  ["no address", { address: "" }, true],
  ["no date", { date: "" }, true],
  ["no time and not flexible", { timeSlot: "", isFlexible: false }, true],
  ["time no longer available", { timeSlotValid: false }, true],
  ["flexible, so no time needed", { timeSlot: "", isFlexible: true }, true],
  ["bad email", { email: "not-an-email" }, true],
  ["bad phone", { phone: "123" }, true],
  ["card ready", { stripeCardReady: true }, true],
];
let silentBlocks = 0;
for (const [label, patch, agree] of STATES) {
  const d = { ...DRAFT, ...patch };
  for (let s = 0; s <= REVIEW; s++) {
    const blocked = !stepRequirementsMet(s, d, agree);
    const explained = stepBlockers(s, d, agree).length > 0;
    if (blocked !== explained) {
      silentBlocks++;
      console.log(`        ${label}, step ${s}: blocked=${blocked} explained=${explained}`);
    }
  }
}
check("no state blocks without saying why", silentBlocks, 0);

// A step that does not exist is not a step anyone may walk past.
check("an unknown step is blocked", stepRequirementsMet(99, DRAFT, true), false);
check("...and says something rather than nothing", stepBlockers(99, DRAFT, true).length > 0, true);

// ── Arrival and submission are different questions ─────────────────────────
//
// Step 4's requirements gate CONFIRMING, not arriving: a customer must be able
// to reach the review page in order to tick the terms and enter a card.
check(
  "an unticked, card-less draft can still reach the review step",
  maxReachableStep(DRAFT, false),
  REVIEW
);
check(
  "but a draft with no date stops at the schedule step",
  maxReachableStep({ ...DRAFT, date: "" }, true),
  2
);

// ── Wiring ─────────────────────────────────────────────────────────────────
const bookPage = read("src/app/(book)/book/page.tsx");
check(
  "the page shows the reasons, from the same rules that disable the button",
  bookPage.includes("const blockers = stepBlockers(step, draft, agree, bookingPage)"),
  true
);
check(
  "...and there is no second copy of the rules left in it",
  bookPage.includes("function stepRequirementsMet("),
  false
);
check(
  "the missing card no longer fails in silence",
  read("src/app/(book)/book/steps/Step5Review.tsx").includes(
    "We need your name and email before we can take the deposit"
  ),
  true
);
check(
  "nor does a payment form that never arrives",
  read("src/app/(book)/book/steps/Step5Review.tsx").includes(
    "The payment form didn&apos;t load"
  ),
  true
);


// ═══════════════════════════════════════════════════════════════════════════
// Item 13 — cleaner rating system: source, notes, history
// ═══════════════════════════════════════════════════════════════════════════

// A rating's SOURCE is the column the PDF asks for by name. Legacy rows have
// none, and are read rather than backfilled — getting a backfill wrong in bulk
// on live rows is worse than getting one screen wrong.
check("an explicit source is believed", ratingSource({ source: "ADMIN", jobId: "j1" }), "ADMIN");
check(
  "a legacy row from the emailed link is a customer review",
  ratingSource({ source: null, jobId: "j1", ratedBy: "client-link" }),
  "CUSTOMER"
);
check(
  "...and so is one from the portal",
  ratingSource({ source: null, jobId: "j1", ratedBy: "client-portal" }),
  "CUSTOMER"
);
check(
  "a legacy row rated by a USER id is an admin's",
  ratingSource({ source: null, jobId: null, ratedBy: "Jtlez42PQ0jHMgF0voPYBgZYeJS7puuD" }),
  "ADMIN"
);
check(
  "...even when it is attached to a job",
  ratingSource({ source: null, jobId: "j1", ratedBy: "Jtlez42PQ0jHMgF0voPYBgZYeJS7puuD" }),
  "ADMIN"
);
check("nobody recorded: imported", ratingSource({ source: null, jobId: null, ratedBy: null }), "IMPORTED");

// The leak this closed. 41 of the 49 noted ratings in production are admin
// entries, and the public reviews page published any of them above the
// threshold as a customer testimonial.
check(
  "an admin's note is internal",
  isInternalNote({ source: null, jobId: null, ratedBy: "some-admin-id" }),
  true
);
check(
  "a customer's is not",
  isInternalNote({ source: null, jobId: "j1", ratedBy: "client-link" }),
  false
);
check(
  "the public reviews page proves a row is a customer's before printing it",
  read("src/app/(public)/reviews/page.tsx").includes('{ source: "CUSTOMER" }') &&
    read("src/app/(public)/reviews/page.tsx").includes("ratedBy: { in: [...CUSTOMER_RATED_BY] }"),
  true
);

// An admin rating moves a cleaner's pay tier, so the value is clamped and the
// reason is required.
check("a rating is rounded to a tenth", normaliseAdminRating("4.26", 1, 5), { ok: true, value: 4.3 });
check("...and refused out of range", normaliseAdminRating(7, 1, 5).ok, false);
check("...and refused when it is not a number", normaliseAdminRating("good", 1, 5).ok, false);
check(
  "an admin rating cannot be saved without a reason",
  read("src/app/admin/actions/employeeRatings.ts").includes("note.length < 3"),
  true
);
check(
  "an edit is stamped rather than silent",
  read("src/app/admin/actions/employeeRatings.ts").includes("editedAt: new Date()"),
  true
);
check(
  "...and both add and edit move the pay tier with the score",
  (read("src/app/admin/actions/employeeRatings.ts").match(/recalculateMultiplier\(/g) ?? []).length,
  2
);
check(
  "removing a rating keeps it, with the reason on it",
  read("src/app/admin/employees/[id]/RatingHistoryPanel.tsx").includes("setRatingExcluded"),
  true
);

// ═══════════════════════════════════════════════════════════════════════════
// Item 18 — one-off custom checklist
// ═══════════════════════════════════════════════════════════════════════════

check(
  "items are read out of the job's JSON column",
  parseCustomChecklist([
    { title: "Wipe the skirting", description: "Hall only", isRequired: true },
    { title: "Fridge", isRequired: false },
  ]),
  [
    { title: "Wipe the skirting", description: "Hall only", isRequired: true, sortOrder: 0 },
    { title: "Fridge", description: null, isRequired: false, sortOrder: 1 },
  ]
);
check("position in the array IS the order", parseCustomChecklist([{ title: "a" }, { title: "b" }]).map((i) => i.sortOrder), [0, 1]);
check("a titleless item is not an item", parseCustomChecklist([{ title: "   " }, { title: "ok" }]).length, 1);
check("anything not required is required", parseCustomChecklist([{ title: "a" }])[0].isRequired, true);

// A JSON column is only as trustworthy as the last thing that wrote it, and
// this one is read on the cleaner's screen mid-shift.
check("a corrupted column degrades rather than throwing", parseCustomChecklist("nonsense"), []);
check("...as does null", parseCustomChecklist(null), []);
check("...as does an array of junk", parseCustomChecklist([1, "x", null, {}]), []);
check(
  "the list is capped",
  parseCustomChecklist(Array.from({ length: 200 }, (_, i) => ({ title: `t${i}` }))).length,
  CUSTOM_CHECKLIST_MAX_ITEMS
);

check(
  "a custom list beats every template, including a pin",
  read("src/lib/job-checklist.server.ts").includes("if (custom.length > 0)"),
  true
);
check(
  "...and is checked BEFORE the template query, so it works with no templates at all",
  read("src/lib/job-checklist.server.ts").indexOf("parseCustomChecklist(job.customChecklist)") <
    read("src/lib/job-checklist.server.ts").indexOf("db.checklistTemplate.findMany"),
  true
);
check(
  "the job says its checklist is custom",
  CHECKLIST_TIER_LABEL.CUSTOM,
  "Custom for this job"
);
check(
  "a save that does not carry the editor cannot wipe the list",
  read("src/app/admin/actions/saveJob.ts").includes('formData.get("customChecklistSubmitted") === "1"'),
  true
);

// ═══════════════════════════════════════════════════════════════════════════
// Item 19 — cleaner time log change requests
// ═══════════════════════════════════════════════════════════════════════════

const NOW = new Date("2026-09-22T18:00:00.000Z");
const eightFortyFive = new Date("2026-09-22T12:45:00.000Z");
const nine = new Date("2026-09-22T13:00:00.000Z");
const five = new Date("2026-09-22T17:00:00.000Z");

check(
  "a real correction with a reason is accepted",
  checkTimeLogRequest(
    { originalStart: nine, originalEnd: five, requestedStart: eightFortyFive, requestedEnd: five, reason: "Phone died, I started at 8:45." },
    NOW
  ).ok,
  true
);
check(
  "a correction with no reason is not",
  checkTimeLogRequest({ originalStart: nine, originalEnd: five, requestedStart: eightFortyFive, requestedEnd: five, reason: "x" }, NOW).ok,
  false
);
check(
  "a request that changes nothing is refused",
  checkTimeLogRequest({ originalStart: nine, originalEnd: five, requestedStart: nine, requestedEnd: five, reason: "Please fix" }, NOW).ok,
  false
);
check(
  "...to the MINUTE, because nobody types milliseconds",
  checkTimeLogRequest(
    { originalStart: nine, originalEnd: five, requestedStart: new Date(nine.getTime() + 999), requestedEnd: five, reason: "Please fix" },
    NOW
  ).ok,
  false
);
check(
  "finishing before starting is refused",
  checkTimeLogRequest({ originalStart: nine, originalEnd: five, requestedStart: five, requestedEnd: nine, reason: "Please fix" }, NOW).ok,
  false
);
check(
  "a time that has not happened yet is refused",
  checkTimeLogRequest(
    { originalStart: nine, originalEnd: five, requestedStart: nine, requestedEnd: new Date("2026-09-23T13:00:00.000Z"), reason: "Please fix" },
    NOW
  ).ok,
  false
);
check(
  "a shift longer than a day is refused",
  checkTimeLogRequest(
    { originalStart: nine, originalEnd: five, requestedStart: new Date("2026-09-20T13:00:00.000Z"), requestedEnd: five, reason: "Please fix" },
    NOW
  ).ok,
  false
);
check(
  "a shift outside the window is refused, with a reason a cleaner can act on",
  checkTimeLogRequest(
    {
      originalStart: new Date("2026-08-01T13:00:00.000Z"),
      originalEnd: null,
      requestedStart: new Date("2026-08-01T12:45:00.000Z"),
      requestedEnd: null,
      reason: "Missed my clock-in",
    },
    NOW
  ),
  {
    ok: false,
    error: `That shift is more than ${TIME_LOG_REQUEST_WINDOW_DAYS} days ago. Ask the office directly — it may already be paid.`,
  }
);
check("a decided request cannot be decided again", canDecide("APPROVED"), false);
check("...only a pending one can", canDecide("PENDING"), true);

// The dangerous one. `updateClockTimes` reads null as "CLEAR this time", so
// approving a start-only correction with null for the finish would wipe the
// cleaner's clock-out and zero their hours.
const decide = read("src/app/admin/actions/decideTimeLogChange.ts");
check(
  "approving re-sends the side the cleaner did not ask about",
  decide.includes("req.requestedStart ?? current.startedAt") &&
    decide.includes("req.requestedEnd ?? current.endedAt"),
  true
);
check(
  "...read from the clock as it stands NOW, not from the stale stored original",
  decide.includes("db.jobWorkSession.findUnique"),
  true
);
check(
  "the change is applied through the same path an admin uses",
  decide.includes("updateClockTimes({"),
  true
);
check(
  "...and the request is only marked approved once it actually landed",
  decide.indexOf("if (!applied.success)") < decide.indexOf('status: input.approve ? "APPROVED"'),
  true
);
check(
  "a cleaner can only ask about their own entry",
  read("src/app/cleaners/actions/timeLogRequests.ts").includes(
    "row.jobId !== job.id || row.cleanerId !== cleanerId"
  ),
  true
);
check(
  "...and only about a job they are on",
  read("src/app/cleaners/actions/timeLogRequests.ts").includes("if (!onJob)"),
  true
);
check(
  "the admin is notified, as the PDF asks",
  read("src/app/cleaners/actions/timeLogRequests.ts").includes("admin.timelog.change_requested"),
  true
);
check(
  "Notifications has the subsection the PDF names",
  read("src/app/admin/notifications/page.tsx").includes("<TimeLogRequestsPanel"),
  true
);
check(
  "the new table is tenant-isolated like every other",
  read("prisma/migrations/20260922190000_time_log_change_requests/migration.sql").includes(
    'CREATE POLICY "TimeLogChangeRequest_tenant_isolation"'
  ),
  true
);

// ═══════════════════════════════════════════════════════════════════════════
// Items 20 + 21 — series edits and cadence changes
// ═══════════════════════════════════════════════════════════════════════════

check(
  "add-ons follow a series edit (item 20)",
  SERIES_PROPAGATED_FIELDS.includes("price" as never) &&
    read("src/lib/job-series.ts").includes("await db.jobAddOn.deleteMany"),
  true
);
check(
  "the cadence follows a series edit (item 21)",
  SERIES_PROPAGATED_FIELDS.includes("recurringFrequency" as never),
  true
);
check(
  "dates still do NOT propagate — each occurrence has its own slot",
  SERIES_PROPAGATED_FIELDS.includes("startTime" as never),
  false
);
check(
  "...nor does payment state",
  SERIES_PROPAGATED_FIELDS.includes("paymentReceived" as never),
  false
);
check(
  "the log says which scope the edit used (item 20)",
  read("src/app/admin/actions/saveJob.ts").includes('field: "seriesScope"'),
  true
);

const series = read("src/lib/job-series.ts");
check(
  "a cadence change WITHDRAWS occurrences rather than destroying them",
  series.includes("data: { deletedAt: now }") && !series.includes("db.job.deleteMany"),
  true
);
check(
  "...and only ones nobody has started",
  series.includes("clockInTime: null") && series.includes("workSessions: { none: {} }"),
  true
);
check(
  "...that are in the future and not settled",
  series.includes("startTime: { gt: now }") && series.includes("status: { notIn: [...IMMUTABLE_STATUSES] }"),
  true
);
check(
  "changing to one-time ends the series without generating anything",
  series.includes('if (frequency === "ONE_TIME")'),
  true
);
check(
  "a cadence change only fires when the cadence actually changed",
  read("src/app/admin/actions/saveJob.ts").includes("previousFrequency !== nextFrequency"),
  true
);
check(
  "...and only for the whole series, never one occurrence",
  read("src/app/admin/actions/saveJob.ts").includes(
    'formData.get("applyToSeries") === "on" &&\n        existingJob &&\n        previousFrequency'
  ),
  true
);

// ═══════════════════════════════════════════════════════════════════════════
// Item 22 — per-cleaner hourly rates
// ═══════════════════════════════════════════════════════════════════════════

const HOURLY_BASE = {
  id: "j1",
  employeeId: "a",
  cleaners: [{ id: "a" }, { id: "b" }],
  price: 400,
  employeePay: 0,
  payType: "HOURLY",
  hourlyRate: 25,
  jobDate: null,
  startTime: null,
  endTime: null,
  clockInTime: null,
  clockOutTime: null,
  breaks: [],
};
// Three hours each.
const SESSIONS = [
  { cleanerId: "a", startedAt: new Date("2026-09-22T13:00:00Z"), endedAt: new Date("2026-09-22T16:00:00Z") },
  { cleanerId: "b", startedAt: new Date("2026-09-22T13:00:00Z"), endedAt: new Date("2026-09-22T16:00:00Z") },
];

const sameRate = hourlyClockedHours(
  { ...HOURLY_BASE, workSessions: SESSIONS, assignments: [] } as never,
  ["a", "b"]
);
check("with no per-cleaner rate, everyone is on the job's", [sameRate?.rateFor("a"), sameRate?.rateFor("b")], [25, 25]);

const mixed = hourlyClockedHours(
  {
    ...HOURLY_BASE,
    workSessions: SESSIONS,
    assignments: [
      { cleanerId: "a", payAmount: null, status: "ASSIGNED", hourlyRate: 32 },
      { cleanerId: "b", payAmount: null, status: "ASSIGNED", hourlyRate: null },
    ],
  } as never,
  ["a", "b"]
);
check("a field lead on their own rate gets it", mixed?.rateFor("a"), 32);
check("...and the trainee beside them stays on the job's", mixed?.rateFor("b"), 25);
check(
  "the team total is the sum of each cleaner's own hours × own rate",
  hourlyTeamPayFromClock({
    ...HOURLY_BASE,
    workSessions: SESSIONS,
    assignments: [
      { cleanerId: "a", payAmount: null, status: "ASSIGNED", hourlyRate: 32 },
      { cleanerId: "b", payAmount: null, status: "ASSIGNED", hourlyRate: null },
    ],
  } as never),
  171 // 3h × $32 + 3h × $25
);

// A cleaner who left the job takes their rate with them.
check(
  "a cancelled row's rate is history, not a rate",
  hourlyClockedHours(
    {
      ...HOURLY_BASE,
      workSessions: SESSIONS,
      assignments: [{ cleanerId: "a", payAmount: null, status: "CANCELLED", hourlyRate: 99 }],
    } as never,
    ["a", "b"]
  )?.rateFor("a"),
  25
);

// A job with no crew-wide rate used to mean "no hourly math at all". With
// per-cleaner rates it can still be settled.
check(
  "per-cleaner rates alone are enough to settle an hourly job",
  hourlyClockedHours(
    {
      ...HOURLY_BASE,
      hourlyRate: null,
      workSessions: SESSIONS,
      assignments: [{ cleanerId: "a", payAmount: null, status: "ASSIGNED", hourlyRate: 30 }],
    } as never,
    ["a"]
  )?.rateFor("a"),
  30
);
check(
  "no rate anywhere still means the stored team total stands",
  hourlyClockedHours(
    { ...HOURLY_BASE, hourlyRate: null, workSessions: SESSIONS, assignments: [] } as never,
    ["a", "b"]
  ),
  null
);

check(
  "the per-cleaner rate is actually selected, or the math cannot see it",
  read("src/lib/cleaner-earnings.ts").includes(
    "select: { cleanerId: true, payAmount: true, status: true, hourlyRate: true }"
  ),
  true
);
check(
  "a profile rate SEEDS a new assignment rather than being read at pay time",
  read("src/lib/job-assignments.ts").includes("seedRates.get(cleanerId)") &&
    read("src/lib/job-assignments.ts").includes("update: {},"),
  true
);
check(
  "...so re-saving the team cannot push it over a job-specific rate",
  read("src/app/admin/actions/setCleanerDefaultHourlyRate.ts").includes(
    "no pay calculation ever"
  ),
  true
);

// ═══════════════════════════════════════════════════════════════════════════
// Item 23 — deactivating a cleaner clears their future jobs
// ═══════════════════════════════════════════════════════════════════════════

const deact = read("src/lib/cleaner-deactivation.ts");
check(
  "only jobs that have not happened yet",
  deact.includes("startTime: { gte: startOfStoreDay(now) }"),
  true
);
check(
  "...measured from the start of TODAY in the business clock, not from this instant",
  deact.includes("startOfStoreDay(now)"),
  true
);
check(
  "completed, paid and cancelled jobs keep the cleaner for payroll",
  deact.includes('const SETTLED_STATUSES = ["COMPLETED", "CANCELLED", "PAID"]'),
  true
);
check(
  "both halves of an assignment are cleared",
  deact.includes("cleaners: { disconnect:") && deact.includes("employeeId: nextLead"),
  true
);
check(
  "the assignment row is CANCELLED, not deleted, so payroll keeps the history",
  deact.includes('data: { status: "CANCELLED" }'),
  true
);
check(
  "the warning counts the same jobs the write touches",
  (deact.match(/futureAssignedJobsWhere\(/g) ?? []).length >= 3,
  true
);
check(
  "jobs left with nobody on them get a notification of their own",
  deact.includes("admin.jobs.unassigned_by_deactivation"),
  true
);
check(
  "...which lands on a filter that exists",
  read("src/app/admin/jobs/page.tsx").includes('attention === "unassigned"'),
  true
);
check(
  "the admin is warned with a real count before confirming",
  read("src/app/admin/employees/EmployeesView.tsx").includes("previewEmployeeDeactivation"),
  true
);
check(
  "both deactivation paths do it, not just the bulk one",
  read("src/app/admin/actions/updateEmployee.ts").includes("unassignFutureJobs([employeeId])") &&
    read("src/app/admin/actions/bulkEmployeeActions.ts").includes("unassignFutureJobs(cleanIds)"),
  true
);
check(
  "...keyed on the transition, so re-saving an inactive cleaner does not re-run it",
  read("src/app/admin/actions/updateEmployee.ts").includes("!isActive && before?.isActive"),
  true
);

// ═══════════════════════════════════════════════════════════════════════════
// Item 24 — text contrast
// ═══════════════════════════════════════════════════════════════════════════
//
// The ramp had to change SHAPE, not just value. Alpha over #008C9C tops out at
// 4.01:1 on white at alpha 1.0, so no alpha ramp can reach AA — an earlier
// pass raised the alpha and got as far as it could.

function srgb(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function contrast(hex: string, bg: [number, number, number]): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const fg: [number, number, number] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const l = (c: [number, number, number]) =>
    0.2126 * srgb(c[0]) + 0.7152 * srgb(c[1]) + 0.0722 * srgb(c[2]);
  const [hi, lo] = [Math.max(l(fg), l(bg)), Math.min(l(fg), l(bg))];
  return (hi + 0.05) / (lo + 0.05);
}
const WHITE: [number, number, number] = [255, 255, 255];
const ADMIN_CREAM: [number, number, number] = [0xf3, 0xf6, 0xf9];

const globals = read("src/app/globals.css");
const customer = read("src/app/customer.css");
for (const [token, hex] of [
  ["--primary-40", "#007785"],
  ["--primary-50", "#00707d"],
  ["--primary-60", "#006975"],
  ["--primary-70", "#00626d"],
] as const) {
  check(`${token} is a solid teal, not alpha`, globals.includes(`${token}:    ${hex}`), true);
  check(`${token} clears AA on white (${contrast(hex, WHITE).toFixed(2)}:1)`, contrast(hex, WHITE) >= 4.5, true);
  check(`${token} clears AA on the admin surface (${contrast(hex, ADMIN_CREAM).toFixed(2)}:1)`, contrast(hex, ADMIN_CREAM) >= 4.5, true);
  check(`${token} matches in the customer app`, customer.includes(`${token}: ${hex}`), true);
}
// The ramp must still READ as a ramp, or placeholders stop looking like
// placeholders — which the PDF asks for explicitly.
check(
  "the ramp still goes light to dark",
  contrast("#007785", WHITE) < contrast("#00707d", WHITE) &&
    contrast("#00707d", WHITE) < contrast("#006975", WHITE) &&
    contrast("#006975", WHITE) < contrast("#00626d", WHITE),
  true
);
// The fill ramp is a different job and must stay alpha, or borders and tinted
// backgrounds turn into solid teal blocks.
check("the fill ramp is untouched", globals.includes("--primary-10:    rgba(0,140,156,0.10)"), true);

for (const dir of ["src/app/admin", "src/app/cleaners", "src/components"]) {
  check(
    `${dir} no longer uses the unreadable gray`,
    read_dir_has(dir, "text-gray-400"),
    false
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
