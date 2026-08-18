// Verification for STAGE 9 of `_ai_context/TODO.md` — property type on the job
// form and everywhere it matters
// (cleano_inventory_operations_fixes.pdf #11, p.7–8).
//
// Run: npx tsx scripts/verify-stage9-property-type.ts
//
// Three halves, same shape as the other verify-* scripts in this repo:
//   1. The PURE rules, exercised directly — the vocabulary, the parse contract
//      ("" is a real answer, garbage is not), and the BookingKoala inference.
//   2. The SEPARATION this stage exists to protect: property type is not the
//      service category, and capturing it did not change what `normalizeJobType`
//      does to the strings it shares with it.
//   3. A SOURCE SWEEP proving both save paths changed together, that every
//      surface PDF #11 names actually renders it, and that adding a column to
//      the calendar payload did not add a money leak.
//
// The DB is never touched: Stage 9's migration is deferred with the rest of the
// batch, so every check has to hold on code alone.

import fs from "node:fs";
import {
  PROPERTY_TYPES,
  PROPERTY_TYPE_HINT,
  PROPERTY_TYPE_LABEL,
  PROPERTY_TYPE_SHORT_LABEL,
  inferPropertyTypeFromText,
  isPropertyType,
  parsePropertyType,
  propertyTypeLabel,
  propertyTypeShortLabel,
} from "../src/lib/property-type";
import {
  CATEGORY_ALIASES,
  normalizeJobType,
  jobIndustry,
} from "../src/lib/calendar-labels";
import { SERIES_PROPAGATED_FIELDS } from "../src/lib/job-series";
import {
  BOOKING_PAGE_DEFAULTS,
  normalizeBookingPageConfig,
  resolveField,
  resolveStepFields,
  isLockedField,
} from "../src/lib/booking-page-config";
import { REDACTED_CALENDAR_KEYS } from "../src/app/admin/actions/_calendarScope";

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

/* ═══════════════ 1. THE VOCABULARY ════════════════════════════════════════ */
// Decision D8: exactly the PDF's two options, "apartment/condo or house".

check("the enum is the PDF's two options", PROPERTY_TYPES, [
  "APARTMENT_CONDO",
  "HOUSE",
]);
ok(
  "...and mirrors `enum PropertyType` in schema.prisma",
  (() => {
    const block = /enum PropertyType \{([^}]*)\}/.exec(read("prisma/schema.prisma"));
    if (!block) return false;
    const values = block[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//") && !l.startsWith("///"));
    return JSON.stringify(values) === JSON.stringify([...PROPERTY_TYPES]);
  })()
);
ok(
  "every value has a label, a short label and a hint — no surface invents wording",
  PROPERTY_TYPES.every(
    (p) =>
      !!PROPERTY_TYPE_LABEL[p] &&
      !!PROPERTY_TYPE_SHORT_LABEL[p] &&
      !!PROPERTY_TYPE_HINT[p]
  )
);
ok(
  "isPropertyType admits the two and nothing else",
  isPropertyType("HOUSE") &&
    isPropertyType("APARTMENT_CONDO") &&
    !isPropertyType("APARTMENT") &&
    !isPropertyType("house") &&
    !isPropertyType("") &&
    !isPropertyType(null)
);

// NULL, not a default. "Not recorded" is the state of every row written before
// this column, and a label helper that answered "Apartment / Condo" for null
// would print a guess on all of them.
check("an unset value has no label", propertyTypeLabel(null), null);
check("...nor a short one", propertyTypeShortLabel(undefined), null);
check("...and neither does a garbage one", propertyTypeLabel("DUPLEX"), null);
check("a real one does", propertyTypeLabel("HOUSE"), "House");
check("...and the short form is the compact one", propertyTypeShortLabel("APARTMENT_CONDO"), "Apt");

/* ═══════════════ 2. THE PARSE CONTRACT ════════════════════════════════════ */
// The blank option is a real choice on both job forms and in the booking flow.
// Anything unrecognised has to land on null, never on a default — a silent
// default here would stamp a guess on every job saved by a form that omits the
// control, and on every crafted request to the PUBLIC submitBooking action.

check("the blank option clears the column", parsePropertyType(""), null);
check("...as does an absent value", parsePropertyType(undefined), null);
check("...and a non-string", parsePropertyType(42), null);
check("...and an unknown string", parsePropertyType("MANSION"), null);
check("a valid value parses", parsePropertyType("HOUSE"), "HOUSE");
check("...case-insensitively, with whitespace", parsePropertyType("  apartment_condo "), "APARTMENT_CONDO");

/* ═══════════════ 3. THE BOOKINGKOALA INFERENCE (step 9.6) ═════════════════ */
// The CSV's "Service" column mixes property words with genuine service names.
// The property words are what this stage recovers; the service names must come
// back null rather than being forced into a bucket.

for (const [raw, expected] of [
  ["House", "HOUSE"],
  ["Apartment", "APARTMENT_CONDO"],
  ["Condo", "APARTMENT_CONDO"],
  ["Townhouse", "HOUSE"],
  ["Detached Home (2000+ sqft)", "HOUSE"],
  ["DETACHED_HOME", "HOUSE"],
  ["Semi-Detached Home", "HOUSE"],
  ["2 Bedroom Apartment", "APARTMENT_CONDO"],
  ["Condominium cleaning", "APARTMENT_CONDO"],
  ["Duplex", "HOUSE"],
  // Service names, not property words — null, not a guess.
  ["Deep Cleaning", null],
  ["Move In & Out", null],
  ["Post Construction Cleaning", null],
  ["Commercial", null],
  ["Airbnb Turnover", null],
  ["", null],
  [null, null],
] as const) {
  check(
    `inferPropertyTypeFromText(${JSON.stringify(raw)}) → ${expected}`,
    inferPropertyTypeFromText(raw),
    expected
  );
}
ok(
  "word boundaries hold: a warehouse is not a house",
  inferPropertyTypeFromText("Warehouse Cleaning") === null
);
ok(
  "a mixed phrase resolves to the unit, the more specific of the two",
  inferPropertyTypeFromText("Townhouse Condo") === "APARTMENT_CONDO"
);

/* ═══════════════ 4. PROPERTY TYPE IS NOT THE SERVICE CATEGORY ═════════════ */
// The whole reason this column exists. `CATEGORY_ALIASES` folds the same five
// CSV words onto RESIDENTIAL, and that fold must be UNCHANGED — Stage 9 reads
// the string before the fold, it does not repurpose the fold.

for (const word of ["HOUSE", "APARTMENT", "CONDO", "TOWNHOUSE", "DETACHED_HOME"]) {
  check(
    `${word} still aliases to the RESIDENTIAL service category`,
    CATEGORY_ALIASES[word],
    "RESIDENTIAL"
  );
}
check(
  "...and still normalises that way through the descriptive form",
  normalizeJobType("Detached Home (2000+ sqft)"),
  "RESIDENTIAL"
);
check(
  "...so analytics still counts it as Residential industry",
  jobIndustry("Condo"),
  "RESIDENTIAL"
);
// Asserted against the module SPECIFIERS, not the raw text: this file's own
// header names `calendar-labels` and `@prisma/client` in prose, explaining
// exactly why it doesn't import them, and a substring check would read that
// explanation as the violation it warns about.
const PROPERTY_MODULE = read("src/lib/property-type.ts");
const propertyImports = [
  ...PROPERTY_MODULE.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm),
  ...PROPERTY_MODULE.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
].map((m) => m[1]);

check(
  "property-type.ts imports nothing at all — it is pure by construction",
  propertyImports,
  []
);
ok(
  "...so it cannot couple to the service-category module",
  !propertyImports.some((m) => m.includes("calendar-labels"))
);
for (const forbidden of ["@/db", "server-only", "@prisma/client"]) {
  ok(
    `...nor pull in ${forbidden}, which would break the client components that render it`,
    !propertyImports.some((m) => m === forbidden || m.startsWith(`${forbidden}/`))
  );
}

/* ═══════════════ 5. THE COLUMN, THE MIGRATION, THE SERIES ═════════════════ */

const SCHEMA = read("prisma/schema.prisma");
const MIGRATION =
  "prisma/migrations/20260817040000_add_property_type/migration.sql";

ok("Job carries the column", /propertyType\s+PropertyType\?/.test(SCHEMA));
ok(
  "...and it is NULLABLE — 'not recorded' is the honest state for history",
  /propertyType\s+PropertyType\?/.test(SCHEMA) &&
    !/propertyType\s+PropertyType\s/.test(SCHEMA)
);
has("the migration creates the type", MIGRATION, 'CREATE TYPE "PropertyType"');
has("...and adds the column", MIGRATION, 'ADD COLUMN "propertyType"');
ok(
  "...with NO default, so no existing row is stamped with a guess",
  !/ADD COLUMN "propertyType"[^;]*DEFAULT/i.test(read(MIGRATION))
);
ok(
  "the migration is additive only — nothing dropped, nothing rewritten",
  !/\b(DROP|UPDATE|DELETE)\b/i.test(
    read(MIGRATION)
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
  )
);

// Step 9.3 — it describes the ADDRESS, and the address already propagates.
ok(
  "propertyType carries across a recurring series",
  (SERIES_PROPAGATED_FIELDS as readonly string[]).includes("propertyType")
);

/* ═══════════════ 6. SOURCE SWEEP ══════════════════════════════════════════ */

const SAVE_ACTION = "src/app/admin/actions/saveJob.ts";
const SAVE_PAGE = "src/app/admin/jobs/new/page.tsx";
const MODAL = "src/app/admin/jobs/JobModal.tsx";
const FULL_FORM_FIELD = "src/app/admin/jobs/new/PropertyTypeField.tsx";

// ── The two save paths change TOGETHER (TODO §4's ⚠️, and step 14.3). ───────
for (const [label, path] of [
  ["the shared action", SAVE_ACTION],
  ["the full-page form", SAVE_PAGE],
] as const) {
  has(`${label} persists propertyType`, path, "propertyType,");
  has(
    `${label} parses it through the shared helper, never by hand`,
    path,
    "parsePropertyType(formData.get(\"propertyType\"))"
  );
  has(
    `${label} preserves it when the form doesn't own the control`,
    path,
    'formData.has("propertyType")'
  );
  has(
    `${label} falls back to the stored value, not to a default`,
    path,
    "if (!propertySubmitted) propertyType = preservedFields?.propertyType ?? null;"
  );
  // It is property information, not money and not a service: nothing may
  // branch pricing on it.
  ok(
    `${label} never prices off it`,
    !/propertyType[^\n]*(price|Price|rate|Rate|pay|Pay)/.test(read(path))
  );
}
ok(
  "neither save path does a second round-trip for the preserved value",
  [SAVE_ACTION, SAVE_PAGE].every(
    (p) => (read(p).match(/preservedFields =/g) ?? []).length === 1
  )
);

// ── Both admin forms actually render the control (step 9.2). ───────────────
has("the modal renders a Property Type control", MODAL, "Property Type");
has("...prefilled from the job, so an edit can't erase it", MODAL, "isPropertyType(job.propertyType)");
has("...and posts it on every save, blank included", MODAL, 'formData.append("propertyType", propertyType)');
has("the full-page form has its own control", FULL_FORM_FIELD, 'name="propertyType"');
has("...mounted on the page", SAVE_PAGE, "<PropertyTypeField");
has(
  "...seeded from the job being edited",
  SAVE_PAGE,
  "(prefill as any)?.propertyType"
);
// A rendered-but-unprefilled control is what reset `payType` and `billingType`
// on a jobs-list quick edit in earlier stages. Same trap, same guard.
has(
  "the jobs list carries the column, so a quick edit can't reset it",
  "src/app/admin/jobs/page.tsx",
  "propertyType: true,"
);
has(
  "the calendar drawer seeds the modal with it too",
  "src/components/calendar/CalendarJobActions.tsx",
  "propertyType: summary.propertyType,"
);

// ── Every surface PDF #11 names (step 9.4). ────────────────────────────────
const SURFACES: Array<[string, string, string]> = [
  [
    "job details",
    "src/app/admin/jobs/[id]/JobDetailView.tsx",
    "propertyTypeLabel(job.propertyType)",
  ],
  [
    "the cleaner job view",
    "src/app/cleaners/my-jobs/[jobId]/page.tsx",
    "propertyTypeLabel(job.propertyType)",
  ],
  [
    "the available-jobs card",
    "src/app/cleaners/available-jobs/AvailableJobsClient.tsx",
    "propertyTypeLabel(propertyType)",
  ],
  [
    "the available-job preview",
    "src/app/cleaners/available-jobs/JobPreviewModal.tsx",
    "propertyTypeLabel(data.propertyType)",
  ],
  [
    "the calendar card",
    "src/components/calendar/EventCard.tsx",
    "propertyLabel(event)",
  ],
  [
    "the calendar list",
    "src/components/calendar/ListView.tsx",
    "propertyLabel(event)",
  ],
  [
    "the calendar drawer",
    "src/components/calendar/CalendarJobActions.tsx",
    "propertyTypeLabel(summary.propertyType)",
  ],
  [
    "the customer booking details",
    "src/app/(customer)/(secured)/bookings/[id]/page.tsx",
    "propertyTypeLabel(job.propertyType)",
  ],
  [
    "the booking review step",
    "src/app/(book)/book/steps/Step5Review.tsx",
    "propertyTypeLabel(draft.propertyType)",
  ],
  [
    "the cleaner calendar drawer",
    "src/app/admin/calendar/CleanerCalendarClient.tsx",
    "propertyTypeLabel(job.propertyType)",
  ],
];
for (const [label, path, needle] of SURFACES) {
  has(`${label} renders the property type`, path, needle);
}
// Every one of them renders through the shared label helper, so none can print
// the raw enum or invent its own wording.
for (const [label, path] of SURFACES.map((s) => [s[0], s[1]] as const)) {
  ok(
    `${label} never prints the raw enum value`,
    !/["'`]APARTMENT_CONDO["'`]/.test(read(path))
  );
}

// ── The calendar payload grew a column but not a leak (Stage 7's rule). ────
has(
  "the calendar select carries it",
  "src/app/admin/actions/_calendarSelect.ts",
  "propertyType: true,"
);
for (const feed of [
  "src/app/admin/actions/getJobsForDay.ts",
  "src/app/admin/actions/getJobsForCalendar.ts",
]) {
  has(`${feed} puts it in metadata`, feed, "propertyType: job.propertyType,");
}
ok(
  "...and it is NOT redacted — a building type is not a dollar figure",
  !(REDACTED_CALENDAR_KEYS as readonly string[]).includes("propertyType")
);
ok(
  "the money list is unchanged by this stage",
  JSON.stringify(REDACTED_CALENDAR_KEYS) ===
    JSON.stringify([
      "price",
      "employeePay",
      "totalTip",
      "parking",
      "paymentReceived",
      "invoiceSent",
      "billedHourlyRate",
    ])
);
// The cleaner-facing surfaces still show no customer money — Stage 9 added a
// field to three of them, so re-assert the boundary it could have crossed.
lacks(
  "the available-jobs preview still withholds the customer price",
  "src/app/cleaners/available-jobs/getAvailableJobPreview.ts",
  "price: job.price,"
);
lacks(
  "the cleaner job view still shows no customer hourly rate",
  "src/app/cleaners/my-jobs/[jobId]/page.tsx",
  "billedHourlyRate"
);

// ── The booking flow (step 9.5). ───────────────────────────────────────────
const BOOKING_FIELD = resolveField(
  BOOKING_PAGE_DEFAULTS,
  "property",
  "propertyType"
);
ok("the booking page offers a propertyType field", !!BOOKING_FIELD);
ok("...visible by default", BOOKING_FIELD?.visible === true);
ok(
  "...and OPTIONAL — it prices nothing, so a booking without it is valid",
  BOOKING_FIELD?.required === false &&
    !isLockedField("property", "propertyType")
);
check(
  "...and it sits between the service picker and the room counts",
  resolveStepFields(BOOKING_PAGE_DEFAULTS, "property")
    .map((f) => f.key)
    .slice(3, 6),
  ["serviceType", "propertyType", "bedCount"]
);
// A store that has already saved a booking-page edit keeps its stored integer
// orders; the new key falls back to its default. The fractional order is what
// makes it slot in correctly in BOTH cases rather than colliding with bedCount.
check(
  "...including for a config saved before this field existed",
  (() => {
    const legacy = {
      fields: {
        property: [
          { key: "savedAddress", order: 0 },
          { key: "address", order: 1 },
          { key: "aptNumber", order: 2 },
          { key: "serviceType", order: 3 },
          { key: "bedCount", order: 4 },
          { key: "bathCount", order: 5 },
        ],
      },
    };
    return resolveStepFields(normalizeBookingPageConfig(legacy), "property")
      .map((f) => f.key)
      .slice(3, 6);
  })(),
  ["serviceType", "propertyType", "bedCount"]
);
has(
  "the booking step renders the choice",
  "src/app/(book)/book/steps/Step2Property.tsx",
  'case "propertyType":'
);
has(
  "the draft carries it",
  "src/app/(book)/book/types.ts",
  "propertyType: string;"
);
has(
  "...starting unanswered, not on a guess",
  "src/app/(book)/book/types.ts",
  'propertyType: "",'
);
has(
  "the booking page sends it",
  "src/app/(book)/book/page.tsx",
  "propertyType: draft.propertyType,"
);
// PUBLIC action — the value is re-parsed server-side, never trusted.
has(
  "submitBooking re-parses it rather than trusting the client",
  "src/app/(book)/actions/submitBooking.ts",
  "const propertyType = parsePropertyType(input.propertyType);"
);
ok(
  "...and writes it to the primary job AND every recurring child",
  (read("src/app/(book)/actions/submitBooking.ts").match(
    /^\s+propertyType,$/gm
  ) ?? []).length === 2
);

// ── BookingKoala (step 9.6). ───────────────────────────────────────────────
const BK_CORE = "src/lib/bookingkoala/core.ts";
has("the parser captures the property word", BK_CORE, "inferPropertyTypeFromText(clean(get(\"Service\")))");
ok(
  "...from the RAW column, before mapService collapses it",
  read(BK_CORE).indexOf('inferPropertyTypeFromText(clean(get("Service")))') >
    read(BK_CORE).indexOf("export function mapService")
);
ok(
  "mapService itself is untouched — the service fold still behaves as before",
  /else jobType = "RESIDENTIAL"; \/\/ House \/ Apartment \/ N-Bedroom \/ Detached/.test(
    read(BK_CORE)
  )
);
has(
  "the importer writes it",
  "src/app/admin/actions/runBookingKoalaImport.ts",
  "propertyType: r.job.propertyType,"
);
has(
  "the dry-run table shows how each row classified, so the heuristic is reviewable",
  "src/components/csv/BookingKoalaImportButton.tsx",
  "propertyTypeLabel(s.propertyType)"
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
