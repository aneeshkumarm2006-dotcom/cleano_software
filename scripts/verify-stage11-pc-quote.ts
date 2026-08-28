// Verification for STAGE 11 of `_ai_context/TODO.md` — post-construction deposit
// + photo quote flow (cleano_inventory_operations_fixes.pdf #9, p.7).
//
// Run: npx tsx scripts/verify-stage11-pc-quote.ts
//
// Four halves, same shape as the other verify-* scripts in this repo:
//   1. The PURE rules, exercised directly — the quote vocabulary, the deposit
//      resolution contract (including the "NULL means $20" fallback that keeps
//      every historical row unchanged), and the photo-URL trust boundary.
//   2. The MONEY invariant this stage exists to protect: a job credits, refunds
//      and invoices the deposit IT charged, never a constant.
//   3. The GUARD RAILS of step 11.7 — no cleaner-facing surface can see an
//      unsettled quote, and the rule is enforced in the WHERE clause as well as
//      in the read.
//   4. A SOURCE SWEEP proving every surface PDF #9 names actually changed, and
//      that the six places the old hardcoded `20` lived are all gone.
//
// The DB is never touched: Stage 11's migration is deferred with the rest of the
// batch, so every check has to hold on code alone.

import fs from "node:fs";
import {
  BOOKING_PHOTO_MAX,
  BOOKING_PHOTO_MIN,
  BOOKING_PHOTO_UPLOADER_LABEL,
  DEPOSIT_INTENT_KINDS,
  PC_DEPOSIT_DEFAULT_USD,
  PC_DEPOSIT_SETTING_KEY,
  STANDARD_BOOKING_DEPOSIT_USD,
  depositCentsForService,
  depositIntentKind,
  depositUsdForService,
  formatDeposit,
  isBookingPhotoUrl,
  isDepositIntentKind,
  isQuotedService,
  resolveDepositCredit,
} from "../src/lib/booking-deposit";
import {
  DEPOSIT_DISPOSITIONS,
  DEPOSIT_DISPOSITION_HINT,
  DEPOSIT_DISPOSITION_LABEL,
  QUOTE_STATUSES,
  QUOTE_STATUSES_HIDDEN_FROM_CLEANERS,
  QUOTE_STATUS_HINT,
  QUOTE_STATUS_LABEL,
  QUOTE_STATUS_TONE,
  isAwaitingQuote,
  isDepositDisposition,
  isQuoteStatus,
  needsQuoteReview,
  parseQuoteStatus,
  quoteStatusLabel,
} from "../src/lib/quote-status";
import { BOOKING_DEPOSIT_CENTS } from "../src/lib/stripe";
import { BOOKING_DEPOSIT_USD, resolveAmountDue } from "../src/lib/job-billing";
import {
  claimableJobsWhere,
  cleanerAssignedWhere,
  fieldLeadScopedJobsWhere,
  quoteSettledFilter,
  upcomingJobsWhere,
  doneJobsWhere,
  pastJobsWhere,
  cancelledJobsWhere,
} from "../src/lib/cleaner-jobs";
import {
  BOOKING_PAGE_DEFAULTS,
  isFieldRequired,
  isFieldVisible,
  isLockedField,
  normalizeBookingPageConfig,
  resolveField,
} from "../src/lib/booking-page-config";
import { postConstructionBasePrice } from "../src/lib/service-pricing";
import { bookingPhotoFolderFor } from "../src/lib/asset-paths";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const okv = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${okv ? "PASS" : "FAIL"}  ${name}`);
  if (!okv) {
    console.log(
      `        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
  okv ? pass++ : fail++;
}
const ok = (n: string, c: boolean) => check(n, c, true);

const read = (p: string) => fs.readFileSync(p, "utf8");
const has = (name: string, path: string, needle: string) =>
  ok(name, read(path).includes(needle));
const lacks = (name: string, path: string, needle: string) =>
  ok(name, !read(path).includes(needle));

function section(title: string, body: () => void) {
  console.log(`\n── ${title} ──`);
  body();
}

/* ═══════════════ 1. THE VOCABULARY ════════════════════════════════════════ */

section("1 · quote lifecycle vocabulary", () => {
  check("the enum is the four states PDF #9 implies", QUOTE_STATUSES, [
    "PENDING_REVIEW",
    "QUOTED",
    "ACCEPTED",
    "DECLINED",
  ]);
  ok(
    "...and mirrors `enum QuoteStatus` in schema.prisma",
    (() => {
      const block = /enum QuoteStatus \{([^}]*)\}/.exec(read("prisma/schema.prisma"));
      if (!block) return false;
      const values = block[1]
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("//") && !l.startsWith("///"));
      return JSON.stringify(values) === JSON.stringify([...QUOTE_STATUSES]);
    })()
  );
  ok(
    "...and the migration creates exactly those values",
    (() => {
      const sql = read(
        "prisma/migrations/20260817060000_add_pc_quote_flow/migration.sql"
      );
      const m = /CREATE TYPE "QuoteStatus" AS ENUM \(([^)]*)\)/.exec(sql);
      if (!m) return false;
      const values = m[1]
        .split(",")
        .map((v) => v.trim().replace(/^'|'$/g, ""));
      return JSON.stringify(values) === JSON.stringify([...QUOTE_STATUSES]);
    })()
  );
  ok(
    "every state has a label, a hint and a tone — no surface invents wording",
    QUOTE_STATUSES.every(
      (q) => !!QUOTE_STATUS_LABEL[q] && !!QUOTE_STATUS_HINT[q] && !!QUOTE_STATUS_TONE[q]
    )
  );

  // The parse contract: nothing but the four values may reach the column.
  check("a known value parses", parseQuoteStatus("quoted"), "QUOTED");
  check("garbage does not", parseQuoteStatus("MAYBE"), null);
  check("neither does an object", parseQuoteStatus({}), null);
  check("nor an empty string", parseQuoteStatus(""), null);
  check("null = not a quote, and has no label", quoteStatusLabel(null), null);
  ok("...and is not a quote status", !isQuoteStatus(null));

  // The visibility rule (step 11.7). ACCEPTED and NULL must be visible; the
  // other three must not.
  check(
    "three states hide a job from cleaners",
    [...QUOTE_STATUSES_HIDDEN_FROM_CLEANERS],
    ["PENDING_REVIEW", "QUOTED", "DECLINED"]
  );
  ok("an unreviewed quote is hidden", isAwaitingQuote("PENDING_REVIEW"));
  ok("a sent quote is hidden", isAwaitingQuote("QUOTED"));
  ok("a declined quote is hidden — dead, not merely unscheduled", isAwaitingQuote("DECLINED"));
  ok("an ACCEPTED quote is ordinary work", !isAwaitingQuote("ACCEPTED"));
  ok("a non-quote job is ordinary work", !isAwaitingQuote(null));
  ok(
    "...and so is a job whose column a stale select never fetched",
    !isAwaitingQuote(undefined)
  );
  ok("only PENDING_REVIEW needs an admin to price it", needsQuoteReview("PENDING_REVIEW"));
  ok("...not a sent one", !needsQuoteReview("QUOTED"));
});

section("1b · deposit disposition (D11 — no automatic behaviour)", () => {
  check("all three options ship", [...DEPOSIT_DISPOSITIONS], [
    "REFUND",
    "KEEP",
    "PARTIAL",
  ]);
  ok(
    "each has a label and a hint",
    DEPOSIT_DISPOSITIONS.every(
      (d) => !!DEPOSIT_DISPOSITION_LABEL[d] && !!DEPOSIT_DISPOSITION_HINT[d]
    )
  );
  ok("a real one validates", isDepositDisposition("PARTIAL"));
  ok("an invented one does not", !isDepositDisposition("FORFEIT"));
  ok("...nor does an absent choice", !isDepositDisposition(undefined));
  // The action must REFUSE a decline with no disposition rather than default.
  has(
    "declining without a disposition is refused, not defaulted",
    "src/app/admin/actions/resolveJobQuote.ts",
    "if (!isDepositDisposition(input.disposition))"
  );
  has(
    "...and KEEP/PARTIAL demand a reason, because the record has to answer the customer",
    "src/app/admin/actions/resolveJobQuote.ts",
    'error: "Add a short reason'
  );
});

/* ═══════════════ 2. THE MONEY ═════════════════════════════════════════════ */

section("2 · the deposit is per-job, never a constant", () => {
  // Which services are quoted.
  ok("post-construction is quoted after review", isQuotedService("POST_CONSTRUCTION"));
  ok("standard is not", !isQuotedService("STANDARD"));
  ok("move-in/out is not", !isQuotedService("MOVE_IN_OUT"));
  ok("neither is an absent service", !isQuotedService(undefined));

  // What each service CHARGES.
  check(
    "a regular booking charges the standard deposit",
    depositUsdForService("STANDARD", 200),
    STANDARD_BOOKING_DEPOSIT_USD
  );
  check(
    "post-construction charges the configured amount",
    depositUsdForService("POST_CONSTRUCTION", 200),
    200
  );
  check(
    "...in cents, which is the unit Stripe works in",
    depositCentsForService("POST_CONSTRUCTION", 200),
    20000
  );
  check(
    "a garbage configured amount falls back to the registry default, never to 0",
    depositUsdForService("POST_CONSTRUCTION", Number.NaN),
    PC_DEPOSIT_DEFAULT_USD
  );
  check(
    "...and a negative one does too — a $0 deposit would make the public action free to abuse",
    depositUsdForService("POST_CONSTRUCTION", -50),
    PC_DEPOSIT_DEFAULT_USD
  );
  check("the standard deposit is still $20 (PDF #9: regular bookings unchanged)",
    STANDARD_BOOKING_DEPOSIT_USD, 20);
  check("...and lib/stripe's cents constant is derived from it, so the two cannot drift",
    BOOKING_DEPOSIT_CENTS, STANDARD_BOOKING_DEPOSIT_USD * 100);
  check("...as is job-billing's dollar constant", BOOKING_DEPOSIT_USD, 20);

  // THE fallback that makes this migration inert on existing data.
  check(
    "a pre-Stage-11 row (depositAmount NULL) credits the $20 it really charged",
    resolveDepositCredit({ depositPaid: true, depositAmount: null }),
    20
  );
  check(
    "...as does one whose select never fetched the column",
    resolveDepositCredit({ depositPaid: true }),
    20
  );
  check(
    "a post-construction row credits what it stored",
    resolveDepositCredit({ depositPaid: true, depositAmount: 200 }),
    200
  );
  check(
    "an unpaid booking credits nothing, whatever the column says",
    resolveDepositCredit({ depositPaid: false, depositAmount: 200 }),
    0
  );
  check(
    "a zero/garbage stored amount falls back rather than crediting 0",
    resolveDepositCredit({ depositPaid: true, depositAmount: 0 }),
    20
  );

  // The invariant every downstream path depends on.
  check(
    "resolveAmountDue takes off the deposit the job charged",
    resolveAmountDue({
      price: null,
      discountAmount: null,
      totalAmount: 805.99,
      depositPaid: true,
      depositAmount: 200,
    }),
    605.99
  );
  check(
    "...and a legacy row is byte-identical to before this stage",
    resolveAmountDue({
      price: 100,
      discountAmount: null,
      totalAmount: 114.98,
      depositPaid: true,
      depositAmount: null,
    }),
    94.98
  );
  check(
    "...never below zero, even when the deposit exceeds the total",
    resolveAmountDue({
      price: null,
      discountAmount: null,
      totalAmount: 150,
      depositPaid: true,
      depositAmount: 200,
    }),
    0
  );
  check("the formatter is the one everyone uses", formatDeposit(200), "$200.00");

  // Intent kinds.
  check("the PC intent is labelled", depositIntentKind("POST_CONSTRUCTION"), "pc_deposit");
  check("a regular one keeps its old label", depositIntentKind("STANDARD"), "booking_deposit");
  check("both kinds verify as deposits", [...DEPOSIT_INTENT_KINDS], [
    "booking_deposit",
    "pc_deposit",
  ]);
  ok("the pre-Stage-11 kind still verifies — intents in flight during a deploy", isDepositIntentKind("booking_deposit"));
  ok("a gift-card intent does not", !isDepositIntentKind("gift_card"));
  ok("nor does an absent kind", !isDepositIntentKind(undefined));
});

section("2b · the six places the hardcoded 20 used to live", () => {
  // Each of these WAS a bare `20`. A regression here silently under-refunds or
  // under-credits a post-construction customer by $180.
  const sites: [string, string][] = [
    ["resolveAmountDue", "src/lib/job-billing.ts"],
    ["issueRefund's deposit cap", "src/app/admin/actions/issueRefund.ts"],
    ["cancelJobByAdmin's refund cap", "src/app/admin/actions/cancelJobByAdmin.ts"],
    ["the admin job detail view", "src/app/admin/jobs/[id]/JobDetailView.tsx"],
    ["the customer portal booking detail", "src/app/(customer)/(secured)/bookings/[id]/page.tsx"],
    ["the receipt PDF", "src/lib/receipt-pdf.ts"],
    ["the invoice PDF", "src/lib/invoice-pdf.ts"],
  ];
  for (const [label, path] of sites) {
    has(`${label} reads the stored deposit`, path, "resolveDepositCredit");
  }
  lacks(
    "issueRefund no longer hardcodes the deposit",
    "src/app/admin/actions/issueRefund.ts",
    "job.depositPaid ? 20 : 0"
  );
  lacks(
    "cancelJobByAdmin no longer hardcodes it",
    "src/app/admin/actions/cancelJobByAdmin.ts",
    "20 - (job.refundedAmount"
  );
  lacks(
    "the job detail view no longer hardcodes it",
    "src/app/admin/jobs/[id]/JobDetailView.tsx",
    "Math.max(0, 20 - refundedSoFar)"
  );
  lacks(
    "the customer portal no longer prints $20",
    "src/app/(customer)/(secured)/bookings/[id]/page.tsx",
    "formatPrice(20)"
  );
  lacks(
    "the calendar cancel modal no longer says $20",
    "src/components/calendar/CalendarJobActions.tsx",
    "Refund the $20 deposit"
  );
  lacks(
    "the booking review step no longer prints a literal $20.00",
    "src/app/(book)/book/steps/Step5Review.tsx",
    "$20.00"
  );
  // Every select that feeds resolveAmountDue has to carry the column.
  for (const path of [
    "src/app/admin/actions/getJobSummary.ts",
    "src/app/admin/bulk-charge/page.tsx",
  ]) {
    has(`${path} selects depositAmount`, path, "depositAmount: true");
  }

  // The deposit credit on both documents (step 11.5).
  has("the receipt shows the credit", "src/lib/receipt-pdf.ts", '"Deposit applied"');
  has("...and the balance after it", "src/lib/receipt-pdf.ts", '"Balance after deposit"');
  has("the invoice shows the credit", "src/lib/invoice-pdf.ts", '"Deposit applied"');
  has("...and the balance due", "src/lib/invoice-pdf.ts", '"Balance due"');
  has(
    "...only on a single-job invoice, since a consolidated one could carry several deposits",
    "src/lib/invoice-pdf.ts",
    "invoice.job ? resolveDepositCredit(invoice.job) : 0"
  );
});

section("2c · the deposit amount is never taken from the client", () => {
  // The route resolves it server-side from the service type.
  has(
    "the charge route resolves the amount server-side",
    "src/app/api/stripe/charge-deposit/route.ts",
    "await resolveDepositCentsForService(requestedService)"
  );
  lacks(
    "...and does not read an amount from the request body",
    "src/app/api/stripe/charge-deposit/route.ts",
    "amount } = await req.json()"
  );
  // submitBooking re-resolves it and holds the intent to that floor.
  has(
    "submitBooking re-resolves the required deposit from the service it is booking",
    "src/app/(book)/actions/submitBooking.ts",
    "await resolveDepositUsdForService(input.serviceType)"
  );
  has(
    "...and verification is held to THAT figure, not a constant",
    "src/app/(book)/actions/submitBooking.ts",
    "if ((pi.amount_received ?? 0) < requiredCents)"
  );
  lacks(
    "...so the old constant floor is gone (a $20 intent could have paid for a $200 quote)",
    "src/app/(book)/actions/submitBooking.ts",
    "< BOOKING_DEPOSIT_CENTS)"
  );
  has(
    "what is STORED is what Stripe says was captured, not what we asked for",
    "src/app/(book)/actions/submitBooking.ts",
    "depositAmount: deposit.amountUsd"
  );
  has(
    "...read off amount_received",
    "src/app/(book)/actions/submitBooking.ts",
    "amountUsd: Math.round(pi.amount_received ?? 0) / 100"
  );
  // The setting is registry-governed and sensitive.
  has("the deposit is a registered setting", "src/lib/settings/registry.ts", "[PC_DEPOSIT_SETTING_KEY]: def({");
  has("...flagged sensitive, because it is charged to a card", "src/lib/settings/registry.ts", "sensitive: true");
  has(
    "the setting key appears in exactly one place outside the registry",
    "src/lib/booking-deposit.server.ts",
    'getSetting("booking.postConstructionDepositUsd")'
  );
  ok(
    "...and no surface reads it directly",
    (() => {
      const hits = [
        "src/app/api/stripe/charge-deposit/route.ts",
        "src/app/(book)/actions/submitBooking.ts",
        "src/app/(book)/book/steps/Step5Review.tsx",
      ].filter((p) => read(p).includes('getSetting("booking.postConstructionDepositUsd")'));
      return hits.length === 0;
    })()
  );
  has("the admin can edit it beside the PC pricing block", "src/app/admin/settings/tabs/PricingRulesTab.tsx", "PC_DEPOSIT_SETTING_KEY");
});

/* ═══════════════ 3. THE GUARD RAILS (step 11.7) ═══════════════════════════ */

section("3 · no cleaner-facing surface sees an unsettled quote", () => {
  // The fragment must spell the NULL case out. `NOT IN (...)` is NULL — not TRUE
  // — for a NULL column in SQL, which would hide every non-quote job in the
  // business. This is the assertion that catches that rewrite.
  check("the fragment is `NULL or ACCEPTED`, not `NOT IN`", quoteSettledFilter(), {
    OR: [{ quoteStatus: null }, { quoteStatus: "ACCEPTED" }],
  });
  lacks(
    "...and is not expressed as a notIn, which would be NULL for every ordinary job",
    "src/lib/cleaner-jobs.ts",
    "quoteStatus: { notIn:"
  );

  const guard = JSON.stringify(quoteSettledFilter());
  const carries = (w: unknown) => JSON.stringify(w).includes(guard);

  ok("the base cleaner scope carries the guard", carries(cleanerAssignedWhere("c1")));
  ok("the available-jobs board carries it", carries(claimableJobsWhere("c1")));
  ok("the field-lead group scope carries it", carries(fieldLeadScopedJobsWhere(["c1"])));

  // The four derived helpers used to spread the base and then overwrite `AND`.
  // Each of these fails if that regression comes back.
  ok("upcoming (My Jobs, dashboard counts) keeps it", carries(upcomingJobsWhere("c1")));
  ok("done keeps it", carries(doneJobsWhere("c1")));
  ok("past keeps it", carries(pastJobsWhere("c1")));
  ok("cancelled keeps it", carries(cancelledJobsWhere("c1")));

  // And the base's own assignment test survives composition — a merged `OR`
  // would widen "my jobs" to "everyone's".
  ok(
    "...without clobbering the cleaner-identity OR",
    JSON.stringify(upcomingJobsWhere("c1")).includes('"employeeId":"c1"')
  );
  ok(
    "an empty field-lead group still fails closed",
    JSON.stringify(fieldLeadScopedJobsWhere([])) === JSON.stringify({ id: { in: [] } })
  );

  // claimJob takes a jobId from the client, so the board's filter alone is
  // decorative — the action needs the rule too, in the read AND the write.
  has(
    "claimJob refuses an unsettled quote on the read",
    "src/app/cleaners/available-jobs/claimJob.ts",
    "if (isAwaitingQuote(job.quoteStatus))"
  );
  // Matched on the CALL, not on the whole `AND: [...]` literal it sits in: AWER
  // round 4 fix 6 added `openForClaimFilter()` beside it, and this check is
  // about the quote guard being in the race window — not about being the only
  // thing there. Pinning the array literal made an unrelated guard's arrival
  // read as the quote guard leaving.
  has(
    "...and in the compare-and-set WHERE, so an admin un-quoting mid-claim wins the race",
    "src/app/cleaners/available-jobs/claimJob.ts",
    "AND: [quoteSettledFilter(),"
  );
  has(
    "the available-jobs preview reuses claimableJobsWhere rather than restating it",
    "src/app/cleaners/available-jobs/getAvailableJobPreview.ts",
    "claimableJobsWhere(cleanerId, new Date())"
  );
});

/* ═══════════════ 4. THE FLOW ══════════════════════════════════════════════ */

section("4 · booking: photos are required and validated", () => {
  check("the minimum is 2 (PDF #9's 'pictures', plural)", BOOKING_PHOTO_MIN, 2);
  check("the maximum is 10", BOOKING_PHOTO_MAX, 10);

  // The photos field is config-driven, visible + required + LOCKED for PC.
  const cfg = BOOKING_PAGE_DEFAULTS;
  ok(
    "the field exists in the property step catalog",
    !!resolveField(cfg, "property", "photos")
  );
  ok(
    "hidden for a standard booking — nobody photographs a routine clean",
    !isFieldVisible(cfg, "property", "photos", "STANDARD")
  );
  ok(
    "visible and required for post-construction",
    isFieldRequired(cfg, "property", "photos", "POST_CONSTRUCTION")
  );
  ok(
    "...and LOCKED, so an admin cannot switch off the input the quote is built on",
    isLockedField("property", "photos", "POST_CONSTRUCTION")
  );
  ok(
    "...but not locked for other services, which are free to hide it",
    !isLockedField("property", "photos", "STANDARD")
  );
  ok(
    "a stored config that tries to hide it for PC is overridden on read",
    (() => {
      const stored = normalizeBookingPageConfig({
        overrides: {
          POST_CONSTRUCTION: { "property.photos": { visible: false, required: false } },
        },
      });
      return isFieldRequired(stored, "property", "photos", "POST_CONSTRUCTION");
    })()
  );

  // The trust boundary on the URL. This is what stops a public upload action
  // becoming "attach any image on the internet to a job record".
  const CLOUD = "cleano-demo";
  // Each company has its own booking folder now, so the check needs to be told
  // WHOSE it is running for.
  const MINE = bookingPhotoFolderFor("teamcleano");
  const THEIRS = bookingPhotoFolderFor("acme-cleaning");
  const good = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${MINE}/abc123.jpg`;
  ok("a URL from our folder on our cloud is accepted", isBookingPhotoUrl(good, CLOUD, MINE));
  ok(
    "another cloud's URL is refused",
    !isBookingPhotoUrl(
      `https://res.cloudinary.com/someone-else/image/upload/v1/${MINE}/abc.jpg`,
      CLOUD,
      MINE
    )
  );
  ok(
    "another FOLDER on our own cloud is refused — including another job's photos",
    !isBookingPhotoUrl(
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/awer/teamcleano/jobs/someone-elses-job/x.jpg`,
      CLOUD,
      MINE
    )
  );
  // THE ONE THIS SPLIT EXISTS FOR. Under the old single shared folder this URL
  // passed every check — our cloud, the booking folder — and let one company
  // attach a photo of another company's customer's home to its own job.
  ok(
    "ANOTHER COMPANY's booking photo is refused",
    !isBookingPhotoUrl(
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${THEIRS}/abc123.jpg`,
      CLOUD,
      MINE
    )
  );
  ok(
    "and the shared folder we used to write into is refused too",
    !isBookingPhotoUrl(
      `https://res.cloudinary.com/${CLOUD}/image/upload/v1/cleano/booking-uploads/abc.jpg`,
      CLOUD,
      MINE
    )
  );
  ok(
    "an arbitrary host is refused",
    !isBookingPhotoUrl(`https://evil.example/${MINE}/x.jpg`, CLOUD, MINE)
  );
  ok("http is refused", !isBookingPhotoUrl(good.replace("https:", "http:"), CLOUD, MINE));
  ok("a non-URL is refused", !isBookingPhotoUrl("not a url", CLOUD, MINE));
  ok("a data: URI is refused", !isBookingPhotoUrl("data:image/png;base64,AAAA", CLOUD, MINE));
  ok("an absurdly long URL is refused", !isBookingPhotoUrl(good + "?x=" + "a".repeat(4000), CLOUD, MINE));
  ok(
    "and with NO cloud configured, everything is refused — fail closed",
    !isBookingPhotoUrl(good, undefined, MINE)
  );
  ok(
    "with no company folder resolved, everything is refused — fail closed",
    !isBookingPhotoUrl(good, CLOUD, "")
  );

  // Server-side enforcement of the count, independent of the step gate.
  has(
    "submitBooking refuses a photo-less quote request",
    "src/app/(book)/actions/submitBooking.ts",
    "if (isQuote && photoUrls.length < BOOKING_PHOTO_MIN)"
  );
  ok(
    "...before the deposit is verified, so an unquotable booking never takes the money",
    (() => {
      const src = read("src/app/(book)/actions/submitBooking.ts");
      const photos = src.indexOf("if (isQuote && photoUrls.length < BOOKING_PHOTO_MIN)");
      // The CALL, not the function definition, and not the old literal this
      // used to match. When the deposit gained a "waived" path the assignment
      // was reworded, indexOf returned -1, and `photos < -1` reported the
      // ordering as broken when it was fine. An anchor that has gone missing
      // must fail as "I cannot tell", never as "it is wrong".
      const deposit = src.indexOf("const verification: DepositVerification =");
      if (photos < 0 || deposit < 0) {
        throw new Error(
          "verify-stage11: lost track of the photo check or the deposit call in submitBooking.ts — " +
            "the anchors moved, so this assertion cannot answer. Update them.",
        );
      }
      return photos < deposit;
    })()
  );
  has(
    "...and de-duplicates and caps the list",
    "src/app/(book)/actions/submitBooking.ts",
    "new Set("
  );
  has(
    "the step gate counts only photos that finished uploading",
    "src/app/(book)/book/page.tsx",
    "draft.photos.length < BOOKING_PHOTO_MIN"
  );
  // The public upload action's own limits.
  const UP = "src/app/(book)/actions/uploadBookingPhoto.ts";
  has("the upload action validates mime server-side", UP, "BOOKING_PHOTO_MIME_TYPES.includes");
  has("...and size", UP, "file.size > BOOKING_PHOTO_MAX_BYTES");
  has("...and rate-limits by IP", UP, "rateLimited(await clientIp())");
  has("...and never overwrites an existing asset", UP, "overwrite: false");
  lacks("...and writes nothing to the database", UP, "@/db");
});

section("4b · the job a quote creates", () => {
  const SB = "src/app/(book)/actions/submitBooking.ts";
  has("a post-construction booking is created as a quote request", SB, 'quoteStatus: isQuote ? "PENDING_REVIEW" : null');
  has(
    "...and is never SCHEDULED, however specific the date",
    SB,
    'status: isQuote || input.isFlexible ? "CREATED" : "SCHEDULED"'
  );
  has("the customer's hours are persisted", SB, "pcHours,");
  has("...and their crew size", SB, "pcCleaners,");
  // THE bug PDF #9 reports: pricing multiplied by pcCleaners and then wrote 1.
  has(
    "requiredCleaners is the crew the customer paid for, not a hardcoded 1",
    SB,
    "requiredCleaners: pcCleaners ?? 1"
  );
  lacks("...so the hardcoded 1 is gone from the primary job", SB, "requiredCleaners: 1,\n        // Net of BOTH");
  has("the photos are attached in the same statement as the job", SB, "photos: {");
  has(
    "...with no uploader, which is what the nullable column means",
    SB,
    "BOOKING_PHOTO_CAPTION"
  );
  has(
    "a quote-pending booking generates no recurring series",
    SB,
    "if (!isQuote && recurrences > 0"
  );
  // The price is still an estimate at this point, and says so.
  has("the review step labels the total an estimate", "src/app/(book)/book/steps/Step5Review.tsx", "Estimated total — final quote after photo review");
  has("...and the confirmation screen does not promise a scheduled cleaning", "src/app/(book)/book/page.tsx", "confirmedQuotePending");
  has("...nor does the email", "src/lib/email.ts", "Request received, ");

  // The estimate arithmetic is unchanged — Stage 11 must not silently reprice
  // the service (D14: multiply the RATE by the crew, never redefine the hour).
  check("4h x 1 cleaner at the default rate", postConstructionBasePrice(4, 1), 200);
  check("6h x 2 cleaners", postConstructionBasePrice(6, 2), 600);
  check("under the minimum still bills the minimum", postConstructionBasePrice(2, 1), 200);
  check("crew is clamped to at least 1", postConstructionBasePrice(4, 0), 200);
});

section("4c · admin review, send, accept, decline", () => {
  const SQ = "src/app/admin/actions/sendJobQuote.ts";
  const RQ = "src/app/admin/actions/resolveJobQuote.ts";

  has("only OWNER/ADMIN can price a quote", SQ, 'role !== "OWNER" && role !== "ADMIN"');
  has("...and only they can decide a deposit", RQ, 'role !== "OWNER" && role !== "ADMIN"');
  has("a quote can only be sent while it is live", SQ, '!== "PENDING_REVIEW" && job.quoteStatus !== "QUOTED"');
  has("the quoted figure is stamped FINAL_PRICE", SQ, 'pricingMode: "FINAL_PRICE"');
  has("...and taxes are recomputed from it with the live rates", SQ, "computeJobTaxes(");
  has("...honouring any discount the customer already earned", SQ, "servicePrice - discount");
  has("hourly quotes round with the same helper the clock-out snapshot uses (D7)", SQ, "roundBilledHours(");
  has("...and mirror the derived amount into price, as both save paths do", SQ, "price: servicePrice");
  has("sending a quote does NOT accept it", SQ, "It does not schedule the job");
  has("a failed email is reported, not swallowed", SQ, "The quote was saved, but the email didn't send");
  has("the per-booking client mute is honoured", SQ, "job.notifyClient");

  has("acceptance is the manual flip D10 chose", RQ, "There is no customer-facing accept link yet");
  has("...and only promotes a job that is still CREATED", RQ, 'job.status === "CREATED" && !job.isFlexible');
  has("a quote must be SENT before it can be answered", RQ, 'job.quoteStatus !== "QUOTED"');
  has("the decline is recorded BEFORE the refund is attempted", RQ, "The status flip lands FIRST");
  has("refunds go through the one refund path", RQ, "issueRefund({");
  has("...and a PARTIAL is capped at the remaining deposit", RQ, "amount > depositRemaining + 0.001");
  has("KEEP moves no money", RQ, 'refundTarget = 0');

  // The panel.
  const P = "src/app/admin/jobs/[id]/QuoteReviewPanel.tsx";
  has("the panel shows the CUSTOMER's photos specifically", P, "p.employee === null");
  has("...and warns when there are none to price from", P, "No customer photos on this request");
  has("...shows what the customer estimated", P, "Customer estimate");
  has("...and the deposit already collected", P, "Deposit paid");
  has("...offers hourly and flat", P, '(["HOURLY", "FLAT"] as Mode[])');
  has("...and all three deposit dispositions with no default", P, "DEPOSIT_DISPOSITIONS.map");
  has("the job detail page renders it only for a quote", "src/app/admin/jobs/[id]/JobDetailView.tsx", "isQuoteJob && (");
  has("...guarded by the type predicate, not a truthy test", "src/app/admin/jobs/[id]/JobDetailView.tsx", "isQuoteStatus(job.quoteStatus)");

  // The queue.
  const WB = "src/app/admin/web-bookings/WebBookingsPageClient.tsx";
  has("web bookings has a quote queue", WB, 'case "quotes":');
  has("...that warns when a customer is waiting on US", WB, "awaitingReview");
  has("...labels an unreviewed price as an estimate", WB, "estimate");
  has("...and does not tell an admin to staff an unaccepted quote", WB, 'job.quoteStatus !== "PENDING_REVIEW"');
  has("the photo count comes from a COUNT, not a fetch of 200 rows of URLs", "src/app/admin/web-bookings/page.tsx", "_count: { select: { photos:");
  has("...counting customer uploads only", "src/app/admin/web-bookings/page.tsx", "where: { employeeId: null }");
});

section("4d · the nullable uploader did not break the galleries", () => {
  has(
    "the DTO always has a name to render",
    "src/app/admin/actions/getJobPhotos.ts",
    "p.employee?.name ?? BOOKING_PHOTO_UPLOADER_LABEL"
  );
  check(
    "...and the label reads as the ordinary case it is, not as missing data",
    BOOKING_PHOTO_UPLOADER_LABEL,
    "Customer (at booking)"
  );
  has(
    "a customer photo is admin-only to delete — it is the evidence the quote was priced from",
    "src/app/admin/actions/getJobPhotos.ts",
    "isAdmin || (!!p.employeeId && p.employeeId === session.user.id)"
  );
  has(
    "the job detail page passes a nullable employee through",
    "src/app/admin/jobs/[id]/page.tsx",
    "employee: photo.employee"
  );
  has(
    "the schema documents what NULL means",
    "prisma/schema.prisma",
    "NULL = the CUSTOMER did"
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
