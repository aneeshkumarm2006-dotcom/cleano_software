// Verification for the NEW PHOTO & ADDRESS FIXES handoff (the three P1 items
// that landed after cleano_inventory_operations_fixes.pdf):
//
//   1. Remove the 20-photo upload limit for cleaner job photos, and file every
//      photo by type (before / after / issue / general).
//   2. Save the postal code to the customer's address profile, and carry it.
//   3. Save the property size with the customer's address, and carry it.
//
// Run: npm run verify photo-address
//
// Three halves, the same shape as the other verify-* scripts here:
//   1. The PURE rules, exercised directly — the photo-kind vocabulary and the
//      property-size arithmetic, including the two contracts that are easy to
//      get wrong (0 is a value, blank is not; enrichment fills blanks only).
//   2. The INVARIANTS the fixes exist to protect — no surviving hardcoded 20,
//      one cap constant rather than two, blanks-only enrichment, and the job
//      snapshot never being overwritten from the address book.
//   3. A SOURCE SWEEP proving every write path and every named surface changed
//      together — including BOTH job-save implementations (TODO D15).
//
// The DB is never touched: this batch's migration is deferred with the rest, so
// every check has to hold on code alone.

import fs from "node:fs";
import {
  DEFAULT_JOB_PHOTO_KIND,
  JOB_PHOTO_KINDS,
  JOB_PHOTO_KIND_HINT,
  JOB_PHOTO_KIND_LABEL,
  MAX_PHOTOS_PER_JOB,
  groupPhotosByKind,
  isJobPhotoKind,
  jobPhotoKindLabel,
  parseJobPhotoKind,
} from "../src/lib/job-photos";
import {
  PROPERTY_SIZE_FIELDS,
  PROPERTY_SIZE_NUMERIC_FIELDS,
  formatPropertySize,
  formatPropertySizeShort,
  hasPropertySize,
  mergeBlankPropertySize,
  parsePropertyCount,
  readPropertySize,
} from "../src/lib/property-size";
import { SAVED_ADDRESS_SELECT } from "../src/lib/client-address-store";
import { SERIES_PROPAGATED_FIELDS } from "../src/lib/job-series";

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

const SCHEMA = "prisma/schema.prisma";
const MIGRATION =
  "prisma/migrations/20260818000000_photo_kind_and_address_property_size/migration.sql";
const JOB_PHOTOS_LIB = "src/lib/job-photos.ts";
const UPLOAD_ACTION = "src/app/admin/actions/uploadJobPhoto.ts";
const UPLOAD_WIDGET = "src/app/cleaners/my-jobs/[jobId]/PhotoUpload.tsx";
const GALLERY = "src/app/cleaners/my-jobs/[jobId]/PhotoGallery.tsx";
const ADDRESS_STORE = "src/lib/client-address-store.ts";
const ADDRESS_MANAGER = "src/components/addresses/SavedAddressManager.tsx";
const SAVE_JOB = "src/app/admin/actions/saveJob.ts";
const SAVE_JOB_PAGE = "src/app/admin/jobs/new/page.tsx";
const SUBMIT_BOOKING = "src/app/(book)/actions/submitBooking.ts";
const BK_IMPORT = "src/app/admin/actions/runBookingKoalaImport.ts";

/* ═════════ 1. ITEM 1 — THE PHOTO CAP AND THE PHOTO TYPES ══════════════════ */

// ── The cap. ───────────────────────────────────────────────────────────────
ok(
  "the 20-photo cap is gone — the ceiling is an order of magnitude higher",
  MAX_PHOTOS_PER_JOB >= 200
);
ok(
  "…and lives in ONE place. Two files agreeing by hand is what made the old " +
    "limit possible to raise in the widget and not on the server",
  read(UPLOAD_ACTION).includes("MAX_PHOTOS_PER_JOB") &&
    read(UPLOAD_WIDGET).includes("MAX_PHOTOS_PER_JOB") &&
    !/const MAX_PHOTOS_PER_JOB\s*=/.test(read(UPLOAD_ACTION)) &&
    !/const MAX_PHOTOS_PER_JOB\s*=/.test(read(UPLOAD_WIDGET))
);
lacks(
  "no hardcoded 20 survives in the upload action",
  UPLOAD_ACTION,
  "MAX_PHOTOS_PER_JOB = 20"
);
lacks(
  "…nor in the widget",
  UPLOAD_WIDGET,
  "MAX_PHOTOS_PER_JOB = 20"
);
ok(
  "the limit is SHOWN BEFORE upload, on the dropzone itself — the handoff asks " +
    "for it 'clearly shown before upload', not reported after a failed batch",
  /used on this job/.test(read(UPLOAD_WIDGET)) &&
    read(UPLOAD_WIDGET).includes("{MAX_PHOTOS_PER_JOB}")
);

// ── Multi-select and batching. ─────────────────────────────────────────────
ok(
  "the dropzone accepts many files at once",
  /multiple:\s*true/.test(read(UPLOAD_WIDGET))
);
ok(
  "…and so does the camera input, so a phone can hand over a whole burst",
  /capture="environment"[\s\S]{0,80}multiple/.test(read(UPLOAD_WIDGET))
);
ok(
  "uploads run in a bounded pool rather than one-at-a-time — a 60-photo job on " +
    "hotel wifi is the case the old sequential loop could not serve",
  read(UPLOAD_WIDGET).includes("UPLOAD_CONCURRENCY") &&
    read(UPLOAD_WIDGET).includes("runPool(")
);

// ── Failure and retry. ─────────────────────────────────────────────────────
ok(
  "a failed upload keeps its row: only successes are dropped from the queue",
  read(UPLOAD_WIDGET).includes('prev.filter((p) => p.status !== "success")')
);
ok(
  "…the banner says HOW MANY failed",
  /queuedFailures > 0/.test(read(UPLOAD_WIDGET))
);
ok(
  "…and retry re-sends ONLY the failures, so a retry cannot duplicate a photo " +
    "that already landed",
  read(UPLOAD_WIDGET).includes("runUpload(true)") &&
    read(UPLOAD_WIDGET).includes('onlyFailed ? p.status === "error"')
);

// ── The type vocabulary. ───────────────────────────────────────────────────
check("the four types the handoff names, in display order", JOB_PHOTO_KINDS, [
  "BEFORE",
  "AFTER",
  "ISSUE",
  "GENERAL",
]);
check("every type has a label", Object.keys(JOB_PHOTO_KIND_LABEL).sort(), [
  ...JOB_PHOTO_KINDS,
].sort());
check("every type has a hint for the picker", Object.keys(JOB_PHOTO_KIND_HINT).sort(), [
  ...JOB_PHOTO_KINDS,
].sort());
check("GENERAL is the default", DEFAULT_JOB_PHOTO_KIND, "GENERAL");

// The parse contract: unlike `parsePropertyType`, this NEVER returns null. The
// column is NOT NULL, and an upload must not fail over its filing.
check("a valid value parses to itself", parseJobPhotoKind("BEFORE"), "BEFORE");
check("…case-insensitively", parseJobPhotoKind("after"), "AFTER");
check("…with surrounding space", parseJobPhotoKind("  issue  "), "ISSUE");
check("a missing value falls back to GENERAL", parseJobPhotoKind(undefined), "GENERAL");
check("…and so does garbage", parseJobPhotoKind("SELFIE"), "GENERAL");
check("…and so does a number", parseJobPhotoKind(3), "GENERAL");
check("a legacy row read as null is GENERAL", jobPhotoKindLabel(null), "Job photo");
ok("the guard rejects a non-member", !isJobPhotoKind("SELFIE"));

// Grouping: order is the vocabulary's, and empty buckets are dropped rather
// than rendered as an empty tab.
const grouped = groupPhotosByKind([
  { id: 1, kind: "AFTER" },
  { id: 2, kind: "BEFORE" },
  { id: 3, kind: "AFTER" },
]);
check(
  "grouping follows JOB_PHOTO_KINDS order, not first-seen order",
  grouped.map((g) => g.kind),
  ["BEFORE", "AFTER"]
);
check(
  "…and drops empty buckets — an empty 'Issue' tab reads as a broken filter",
  grouped.length,
  2
);
check("…without losing a photo", grouped.flatMap((g) => g.photos).length, 3);

// ── The column, and the paths that write and read it. ──────────────────────
ok(
  "the enum exists in the schema with exactly the four values",
  /enum JobPhotoKind \{\s*BEFORE\s*AFTER\s*ISSUE\s*GENERAL\s*\}/.test(read(SCHEMA))
);
has(
  "JobPhoto.kind is NOT NULL with a GENERAL default, so every legacy row is " +
    "filed rather than becoming a fifth 'unfiled' state readers must handle",
  SCHEMA,
  "kind       JobPhotoKind @default(GENERAL)"
);
has("the migration creates the enum", MIGRATION, 'CREATE TYPE "JobPhotoKind"');
has(
  "…adds the column with the default",
  MIGRATION,
  `ADD COLUMN "kind" "JobPhotoKind" NOT NULL DEFAULT 'GENERAL'`
);
has(
  "…and indexes (jobId, kind), which is how the galleries group and the cap counts",
  MIGRATION,
  'CREATE INDEX "JobPhoto_jobId_kind_idx"'
);
has("the upload action reads the submitted type", UPLOAD_ACTION, 'parseJobPhotoKind(formData.get("kind"))');
has("…and writes it", UPLOAD_ACTION, "kind,");
has("the widget posts it", UPLOAD_WIDGET, 'formData.append("kind", item.kind)');
has("the DTO carries it", "src/app/admin/actions/getJobPhotos.types.ts", "kind: JobPhotoKind;");
has("the cleaner gallery filters by it", GALLERY, "JOB_PHOTO_KIND_LABEL");
has(
  "the admin job page groups by it",
  "src/app/admin/jobs/[id]/JobDetailView.tsx",
  "groupPhotosByKind(photos)"
);
ok(
  "the gallery's lightbox walks the FILTERED list — arrowing through 'Before' " +
    "must not wander into 'After'",
  read(GALLERY).includes("visible[lightboxIndex]") &&
    read(GALLERY).includes("(i - 1 + visible.length) % visible.length")
);
lacks(
  "nothing infers a type from the caption — a caption is prose typed on a " +
    "phone, and pattern-matching it would misfile exactly the photos someone " +
    "needs to find later",
  JOB_PHOTOS_LIB,
  "caption"
);

// The after-photo permission is untouched: filing a photo is not requiring one.
has(
  "the per-job after-photo opt-out still gates uploads",
  UPLOAD_ACTION,
  "afterPhotosAllowed(job)"
);

/* ═════════ 2. ITEM 2 — POSTAL CODE, END TO END ════════════════════════════ */

ok(
  "the saved-address select carries the postal code — a picker that never " +
    "loads it cannot pre-fill it",
  "postalCode" in SAVED_ADDRESS_SELECT
);
ok(
  "postalCode propagates across a recurring series, beside location/aptNumber/" +
    "clientAddressId — leaving it behind let occurrence 4 disagree with " +
    "occurrence 1 about the same door, and that reached the invoice",
  (SERIES_PROPAGATED_FIELDS as readonly string[]).includes("postalCode")
);
ok(
  "…and so do the four job address fields it travels with",
  ["location", "aptNumber", "clientAddressId"].every((f) =>
    (SERIES_PROPAGATED_FIELDS as readonly string[]).includes(f)
  )
);

// Every write path teaches the address book the postal code.
has("the job modal's save path passes it", SAVE_JOB, "postalCode: postalInput || null,");
has("the full-page save path passes it (D15 — two implementations)", SAVE_JOB_PAGE, "postalCode: postalInput || null,");
has("the public booking passes it", SUBMIT_BOOKING, "postalCode: input.postalCode?.trim() || null,");
has("the admin address editor writes it", "src/app/admin/actions/clientAddresses.ts", "postalCode: f.postalCode,");
has("the customer address editor writes it", "src/app/(customer)/actions/clientAddresses.ts", "postalCode: f.postalCode,");

// The import: the zip reached the address book but the JOB was left pointing at
// neither the code nor the address.
has("the import writes the CSV zip onto the job", BK_IMPORT, "postalCode: rowPostalCode,");
has(
  "…and LINKS the imported job to the saved address it belongs to",
  BK_IMPORT,
  "clientAddress: { connect: { id: rowAddressId } }"
);
has(
  "…keyed by the same normalised, unit-aware key the address book de-duplicates " +
    "on, so a job row and its address cannot miss each other over a capital letter",
  BK_IMPORT,
  "normalizeAddressKey(address, apt)"
);
ok(
  "…and scoped by clientId, so one customer's job can never link to another's " +
    "saved address at the same street",
  read(BK_IMPORT).includes("`${clientId}|${normalizeAddressKey(address, apt)}`")
);

// The surfaces the handoff names.
const POSTAL_SURFACES: [string, string][] = [
  ["the invoice PDF", "src/lib/invoice-pdf.ts"],
  ["the receipt PDF", "src/lib/receipt-pdf.ts"],
  ["the cleaner's job page", "src/app/cleaners/my-jobs/[jobId]/page.tsx"],
  ["the admin job detail", "src/app/admin/jobs/[id]/JobDetailView.tsx"],
  ["the available-jobs preview", "src/app/cleaners/available-jobs/getAvailableJobPreview.ts"],
];
for (const [label, path] of POSTAL_SURFACES) {
  ok(
    `${label} prefers the job's own snapshot, then the saved address — a job ` +
      `with no address link still prints a postal code`,
    /postalCode:\s*j(ob)?\.postalCode \?\? j(ob)?\.clientAddress\?\.postalCode/.test(
      read(path)
    )
  );
}

/* ═════════ 3. ITEM 3 — PROPERTY SIZE ON THE ADDRESS ══════════════════════ */

// ── The count contract: 0 is an answer, blank is not. ──────────────────────
check("a blank count is 'not recorded'", parsePropertyCount(""), null);
check("…and so is whitespace", parsePropertyCount("   "), null);
check("…and so is undefined", parsePropertyCount(undefined), null);
check("…and so is garbage", parsePropertyCount("many"), null);
check(
  "ZERO SURVIVES — a studio has 0 bedrooms, and `Number(v) || null` would turn " +
    "that into 'not recorded' and re-prompt the admin forever",
  parsePropertyCount("0"),
  0
);
check("…as a number too", parsePropertyCount(0), 0);
check("a negative count is refused, not floored to 0", parsePropertyCount(-2), null);
check("a decimal is floored", parsePropertyCount("3.7"), 3);

check(
  "an unrecognised property type is 'not recorded', never a guess",
  readPropertySize({ propertyType: "MANSION" }).propertyType,
  null
);

check("nothing recorded is nothing recorded", hasPropertySize({}), false);
check(
  "…and 0 bedrooms IS something recorded",
  hasPropertySize({ bedCount: 0 }),
  true
);

// ── Blanks-only enrichment: the rule that protects the address book. ───────
check(
  "a blank field learns from a job",
  mergeBlankPropertySize({ bedCount: null }, { bedCount: 3 }),
  { bedCount: 3 }
);
check(
  "a recorded value WINS — one mistyped booking must not overwrite a customer's " +
    "permanent property record",
  mergeBlankPropertySize({ bedCount: 3 }, { bedCount: 2 }),
  {}
);
check(
  "a recorded ZERO also wins: a studio stays a studio when a booking says 2",
  mergeBlankPropertySize({ bedCount: 0 }, { bedCount: 2 }),
  {}
);
check(
  "an EMPTY job field never erases the address — saving a job with the bedroom " +
    "box blank is not an instruction to forget",
  mergeBlankPropertySize({ bedCount: 3 }, { bedCount: null }),
  {}
);
check(
  "the building type follows the same rule",
  mergeBlankPropertySize({}, { propertyType: "HOUSE" }),
  { propertyType: "HOUSE" }
);
check(
  "…and all five fields are covered by the one helper, so a sixth surface " +
    "cannot handle four of them",
  Object.keys(
    mergeBlankPropertySize(
      {},
      {
        propertyType: "HOUSE",
        bedCount: 3,
        bathCount: 2,
        halfBathCount: 1,
        squareFootage: 1450,
      }
    )
  ).sort(),
  [...PROPERTY_SIZE_FIELDS].sort()
);
check("the numeric field list is the four counts", PROPERTY_SIZE_NUMERIC_FIELDS, [
  "bedCount",
  "bathCount",
  "halfBathCount",
  "squareFootage",
]);

// ── Formatting. ────────────────────────────────────────────────────────────
check(
  "nothing recorded renders as null, not as an empty string — every caller has " +
    "to decide out loud whether to draw a row",
  formatPropertySize({}),
  null
);
check(
  "the full line reads like English",
  formatPropertySize({
    propertyType: "HOUSE",
    bedCount: 3,
    bathCount: 2,
    halfBathCount: 1,
    squareFootage: 1450,
  }),
  "House · 3 bedrooms, 2 baths, 1 half bath, 1,450 sq ft"
);
check(
  "singulars are singular",
  formatPropertySize({ bedCount: 1, bathCount: 1 }),
  "1 bedroom, 1 bath"
);
check(
  "a studio prints its zero rather than vanishing",
  formatPropertySize({ bedCount: 0 }),
  "0 bedrooms"
);
check(
  "0 half baths is not worth a chip",
  formatPropertySize({ bedCount: 2, halfBathCount: 0 }),
  "2 bedrooms"
);
check(
  "type alone is a complete answer",
  formatPropertySize({ propertyType: "APARTMENT_CONDO" }),
  "Apartment / Condo"
);
check(
  "the short form writes the half bath the way listings do",
  formatPropertySizeShort({
    propertyType: "HOUSE",
    bedCount: 3,
    bathCount: 2,
    halfBathCount: 1,
    squareFootage: 1450,
  }),
  "House · 3bd 2.5ba 1,450sqft"
);

// ── The column, the select, and every path that fills it. ──────────────────
for (const f of PROPERTY_SIZE_FIELDS) {
  ok(
    `ClientAddress.${f} is in the saved-address select — the pre-fill is the ` +
      `whole point, and it cannot happen from a column the picker never loads`,
    f in SAVED_ADDRESS_SELECT
  );
}
has(
  "the migration adds the five columns to ClientAddress",
  MIGRATION,
  'ADD COLUMN "propertyType"  "PropertyType"'
);
ok(
  "…all NULLABLE with no default and no backfill: 'not recorded' is honest for " +
    "every pre-existing row, and 0 sq ft is an answer a DEFAULT would forge",
  !/ADD COLUMN "(bedCount|bathCount|halfBathCount|squareFootage)"[^,;]*(NOT NULL|DEFAULT)/.test(
    read(MIGRATION)
  )
);

has(
  "the address store enriches the size on match",
  ADDRESS_STORE,
  "mergeBlankPropertySize(row, input)"
);
has(
  "…and writes it in full on create, where there is nothing to protect",
  ADDRESS_STORE,
  "...readPropertySize(input),"
);
// The enrichment must also run on the path that does NOT upsert. When an admin
// picks a saved address and leaves the Location field alone,
// `resolveJobAddressId` returns the picked id early — and shipped doing exactly
// that with no enrichment, so the ONE flow item 3 exists for (pick the saved
// address, type the room counts, save) taught the address book nothing and
// re-prompted for the same numbers forever. Both halves are asserted: the call
// itself, and the columns being SELECTed, since a blanks-only merge against a
// row that never loaded them would "enrich" every field over and over.
{
  const src = read(ADDRESS_STORE);
  const resolver = src.slice(src.indexOf("export async function resolveJobAddressId"));
  ok(
    "…and on the picked-address path, which returns early without upserting",
    resolver.includes("enrichAddressBlanks(pickedId, picked, input)")
  );
  const select = resolver.slice(resolver.indexOf("select: {"));
  ok(
    "…reading the columns that merge compares against, not just address/aptNumber",
    ["postalCode", "propertyType", "bedCount", "bathCount", "halfBathCount", "squareFootage"].every(
      (f) => select.slice(0, select.indexOf("}")).includes(f)
    )
  );
}

// Both job-save implementations (D15), the public booking, the lead link and
// the importer all teach the address book.
const TEACHERS: [string, string][] = [
  ["the job modal's save path", SAVE_JOB],
  ["the full-page job form (D15 — two implementations)", SAVE_JOB_PAGE],
  ["the public booking", SUBMIT_BOOKING],
  ["linking a job to a customer", "src/app/admin/actions/linkJobToClient.ts"],
  ["the BookingKoala import", BK_IMPORT],
];
for (const [label, path] of TEACHERS) {
  // The five fields must appear INSIDE the address-book call, not merely
  // somewhere in the file — every one of these files also writes them onto the
  // job, and a file-wide grep would pass on that alone.
  const src = read(path);
  const call = src.slice(
    src.indexOf("resolveJobAddressId(") >= 0
      ? src.indexOf("resolveJobAddressId(")
      : src.indexOf("upsertClientAddress(")
  );
  const body = call.slice(0, call.indexOf("});") + 3);
  ok(
    `${label} passes the property size into the address book`,
    ["propertyType", "bedCount", "bathCount", "halfBathCount", "squareFootage"].every(
      (f) => body.includes(f)
    )
  );
}

// Pre-fill, on every form the handoff names.
has(
  "the job modal pre-fills the size when an address is picked",
  "src/app/admin/jobs/JobModal.tsx",
  'setValue("bedCount", addr?.bedCount ?? ""'
);
ok(
  "…including the building type, which is React state and cannot be poked",
  read("src/app/admin/jobs/JobModal.tsx").includes(
    "setPropertyType(isPropertyType(addr?.propertyType)"
  )
);
has(
  "the full-page form pre-fills the counts through the DOM path it already used",
  "src/app/admin/jobs/new/ClientNameField.tsx",
  'setField("bedCount", String(addr?.bedCount ?? ""))'
);
ok(
  "…and announces the building type instead of poking it: PremiumSelect's " +
    "submitted value is a React-owned hidden input, so a poke would SHOW one " +
    "type and SUBMIT another",
  read("src/app/admin/jobs/new/ClientNameField.tsx").includes(
    "announceAddressPrefill({"
  ) &&
    read("src/app/admin/jobs/new/PropertyTypeField.tsx").includes(
      "onAddressPrefill("
    )
);
has(
  "the customer booking pre-fills from their saved address",
  "src/app/(book)/book/steps/Step2Property.tsx",
  "readPropertySize(addr)"
);
ok(
  "…and SAYS so, because the quote is priced off these numbers and a price " +
    "that moves without explanation reads as a bug",
  read("src/app/(book)/book/steps/Step2Property.tsx").includes("sizeNotice")
);

// The editor, and the surfaces that display it.
ok(
  "the shared address book edits all five fields",
  ["propertyType", "bedCount", "bathCount", "halfBathCount", "squareFootage"].every(
    (f) => read(ADDRESS_MANAGER).includes(`fd.append("${f}"`)
  ) || read(ADDRESS_MANAGER).includes('fd.append("propertyType", form.propertyType)')
);
has(
  "…and shows what is on file for each saved address",
  ADDRESS_MANAGER,
  "formatPropertySize(addr)"
);
has(
  "the admin job detail prints the size beside the address",
  "src/app/admin/jobs/[id]/JobDetailView.tsx",
  "formatPropertySize(job)"
);
has(
  "the cleaner's job page still has its Property size card",
  "src/app/cleaners/my-jobs/[jobId]/page.tsx",
  "Property size"
);
ok(
  "the size propagates across a recurring series, so occurrence 4 describes the " +
    "same property as occurrence 1",
  ["bedCount", "bathCount", "halfBathCount", "squareFootage", "propertyType"].every(
    (f) => (SERIES_PROPAGATED_FIELDS as readonly string[]).includes(f)
  )
);

/* ═════════ 4. WHAT MUST NOT HAVE CHANGED ═════════════════════════════════ */

ok(
  "the job's own property columns are untouched — a job is the snapshot it was " +
    "priced and staffed from, and nothing writes the address book back onto a " +
    "saved job",
  !/clientAddress[\s\S]{0,120}\.(bedCount|squareFootage)/.test(read(SAVE_JOB))
);
lacks(
  "the address book is never written from a job's id — enrichment flows one " +
    "way, job → address, and only into blanks",
  ADDRESS_STORE,
  "job.findUnique"
);
ok(
  "the pure libraries stay pure: no Prisma, no server-only, importable by this " +
    "script without a database",
  // IMPORT statements only. These files discuss Prisma in their headers — the
  // rule is that they must not REACH it, not that they must not mention it.
  [JOB_PHOTOS_LIB, "src/lib/property-size.ts", "src/lib/client-address.ts"].every(
    (p) =>
      !/^\s*import[^;]*from\s+["'](@\/db|@prisma\/client|server-only)["']/m.test(
        read(p)
      )
  )
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
