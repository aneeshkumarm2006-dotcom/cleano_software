/**
 * Stage 7 — Field Lead: group schedule & availability view.
 * Implements `cleano_inventory_operations_fixes.pdf` #7 (p.6).
 *
 * The stage's risk is not "does the page render" — it is "does widening a Field
 * Lead's job scope from *my jobs* to *my group's jobs* leak client pricing,
 * payroll or another group's crew". So this script asserts, in four parts:
 *
 *   1. SCOPE — the group where-clause is exercised as a pure function, including
 *      the empty-group case, which must fail CLOSED (match nothing) rather than
 *      open (match everything). This is the assertion that matters most: an
 *      `undefined` filter in Prisma is not "no rows", it is "all rows".
 *   2. PROJECTION — every money key the calendar's `metadata` carries is nulled
 *      for a viewer without money rights, and `notes` is sanitized. The key list
 *      is IMPORTED from the projection module and cross-checked against the
 *      calendar select, so a column added to the payload without being handled
 *      fails here instead of shipping.
 *   3. AUTHORIZATION — a source sweep proving each group-scoped read resolves
 *      membership server-side, that writes were NOT widened, and that the
 *      previously unguarded admin pages now carry explicit guards.
 *   4. DTO PRIVACY — the My Team payload does not mention a money field, and its
 *      job select does not fetch one. Fetching is the real boundary; a mapper
 *      that "just doesn't use" a fetched column is one edit away from using it.
 *
 * Run: npx tsx scripts/verify-stage7-field-lead.ts
 */
import fs from "node:fs";
import path from "node:path";
import {
  fieldLeadScopedJobsWhere,
  cleanerAssignedWhere,
  claimableJobsWhere,
} from "../src/lib/cleaner-jobs";
import {
  projectCalendarMetadata,
  REDACTED_CALENDAR_KEYS,
} from "../src/app/admin/actions/_calendarScope";
import { addressArea, clientFirstName } from "../src/lib/team-schedule";

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

const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/**
 * Source with comments removed.
 *
 * Load-bearing for the privacy sweeps below: the modules under test DOCUMENT the
 * fields they exclude ("no `employeePay`…"), so a naive grep for a forbidden
 * word would fail on the very comment that promises it is absent. Stripping
 * first means the assertions read the CODE.
 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CLEANER_JOBS = read("src/lib/cleaner-jobs.ts");
const GROUP = read("src/lib/field-lead-group.server.ts");
const BONUS = read("src/lib/field-lead-bonus.server.ts");
const SCOPE = read("src/app/admin/actions/_calendarScope.ts");
const BADGES = read("src/app/admin/actions/_calendarBadges.ts");
const FOR_DAY = read("src/app/admin/actions/getJobsForDay.ts");
const FOR_CAL = read("src/app/admin/actions/getJobsForCalendar.ts");
const CAL_SELECT = read("src/app/admin/actions/_calendarSelect.ts");
const GET_TEAM = read("src/app/admin/actions/getMyTeam.ts");
const TEAM_TYPES = read("src/app/admin/actions/getMyTeam.types.ts");
const TEAM_PAGE = read("src/app/admin/my-team/page.tsx");
const TEAM_CLIENT = read("src/app/admin/my-team/MyTeamClient.tsx");
const GET_AVAIL = read("src/app/admin/actions/getAvailability.ts");
const SET_AVAIL = read("src/app/admin/actions/setAvailability.ts");
const AVAIL_EXC = read("src/app/admin/actions/availabilityExceptions.ts");
const CHECK_AVAIL = read("src/app/admin/actions/checkAvailability.ts");
const OVERVIEW = read("src/app/admin/employees/AvailabilityOverview.tsx");
// The table itself, extracted in Stage 12 so /admin/availability could render
// the same rendering dated instead of growing a second grid.
const GRID = read("src/components/admin/AvailabilityWeekGrid.tsx");
const EMPLOYEES_PAGE = read("src/app/admin/employees/page.tsx");
const ANALYTICS_PAGE = read("src/app/admin/analytics/page.tsx");
const DASHBOARD_PAGE = read("src/app/admin/dashboard/page.tsx");
const SIDEBAR = read("src/app/admin/Sidebar.tsx");

/* ══════════════════════════════════════════════════════════════════════════
   1 · SCOPE — the group predicate, exercised as a pure function
   ══════════════════════════════════════════════════════════════════════════ */

const A = "lead_1";
const B = "cleaner_2";
const C = "cleaner_3";

// The IDENTITY half of the predicate, asserted on its own.
//
// ⚠️ Deliberately no longer a whole-object equality. Stage 11 ANDs a quote guard
// onto both this builder and `cleanerAssignedWhere` (an unpriced post-construction
// quote must not reach any cleaner-facing surface), and a full-shape assertion
// would fail every time a new company-wide rule is added to the module — which is
// the wrong signal, since what this stage cares about is WHO the predicate matches.
// The guard itself is asserted in verify-stage11-pc-quote.ts, including that it
// survives composition through the four derived helpers.
check(
  "the group predicate matches lead-or-member as employee or assigned cleaner",
  {
    deletedAt: (fieldLeadScopedJobsWhere([A, B, C]) as { deletedAt: unknown }).deletedAt,
    OR: (fieldLeadScopedJobsWhere([A, B, C]) as { OR: unknown }).OR,
  },
  {
    deletedAt: null,
    OR: [
      { employeeId: { in: [A, B, C] } },
      { cleaners: { some: { id: { in: [A, B, C] } } } },
    ],
  }
);

// THE assertion of this stage. An empty group must be an empty schedule.
// `{}` or `undefined` here would be Prisma for "every job in the company".
check(
  "an EMPTY group fails closed — an unsatisfiable predicate, not an empty one",
  fieldLeadScopedJobsWhere([]),
  { id: { in: [] } }
);
check(
  "a group of falsy ids also fails closed",
  fieldLeadScopedJobsWhere(["", null as unknown as string, undefined as unknown as string]),
  { id: { in: [] } }
);
ok(
  "the closed-door predicate can never be satisfied (empty IN list)",
  (fieldLeadScopedJobsWhere([]) as { id: { in: string[] } }).id.in.length === 0
);

check(
  "duplicate ids are collapsed (a lead pointing at themselves can't double-count)",
  (fieldLeadScopedJobsWhere([A, B, A, B, A]) as { OR: unknown }).OR,
  [
    { employeeId: { in: [A, B] } },
    { cleaners: { some: { id: { in: [A, B] } } } },
  ]
);

// Soft-deleted jobs must not appear on a lead's schedule, exactly as they don't
// on a cleaner's own.
ok(
  "soft-deleted jobs are excluded, same as cleanerAssignedWhere",
  (fieldLeadScopedJobsWhere([A]) as { deletedAt: null }).deletedAt === null &&
    (cleanerAssignedWhere(A) as { deletedAt: null }).deletedAt === null
);

// The new builder must not have disturbed its neighbours in the same module.
// Same narrowing as above: Stage 11 adds a quote guard under `AND`, so this checks
// the identity test it was written to protect rather than the whole object.
check(
  "cleanerAssignedWhere's identity test is unchanged",
  {
    deletedAt: (cleanerAssignedWhere(B) as { deletedAt: unknown }).deletedAt,
    OR: (cleanerAssignedWhere(B) as { OR: unknown }).OR,
  },
  { deletedAt: null, OR: [{ employeeId: B }, { cleaners: { some: { id: B } } }] }
);
ok(
  "claimableJobsWhere is unchanged (still CREATED/SCHEDULED only)",
  JSON.stringify(claimableJobsWhere(B, new Date(0)).status) ===
    JSON.stringify({ in: ["CREATED", "SCHEDULED"] })
);

ok(
  "the group builder is documented as failing closed",
  /FAILS CLOSED/.test(CLEANER_JOBS)
);
// The module is imported by client components, so a `db` import — or a VALUE
// import of @prisma/client — would break the bundle, not just the convention.
ok(
  "cleaner-jobs.ts stays PURE — no db import arrived with the new builder",
  !/from "@\/db"/.test(CLEANER_JOBS) &&
    !/^import \{[^}]*\} from "@prisma\/client"/m.test(CLEANER_JOBS) &&
    /^import type \{ Prisma \} from "@prisma\/client";$/m.test(CLEANER_JOBS)
);

/* ══════════════════════════════════════════════════════════════════════════
   2 · PROJECTION — money out of the calendar payload
   ══════════════════════════════════════════════════════════════════════════ */

const RAW_METADATA = {
  jobId: "j1",
  jobType: "DEEP_CLEAN",
  location: "1234 Rue Wellington, Verdun",
  aptNumber: "3",
  status: "SCHEDULED",
  price: 186.5,
  employeePay: 84,
  totalTip: 20,
  parking: 12,
  paymentReceived: true,
  invoiceSent: true,
  // Stage 8 added customer-side hourly billing to the calendar payload. The
  // RATE is money and belongs in REDACTED_CALENDAR_KEYS; the TYPE and the HOURS
  // are scheduling facts a field lead needs, and the assertions below prove
  // both halves of that split.
  billingType: "HOURLY",
  billedHourlyRate: 60,
  billedHours: 4,
  notes: "Gate code 4455, dog is friendly | Final amount CAD: 208.52",
  employeeId: "e1",
  employeeName: "Ann",
  cleaners: [{ id: "e1", name: "Ann" }],
  missingEquipment: [],
  priorityLabel: "ROUTINE",
  rescheduleRequestedAt: null,
};

const admin = projectCalendarMetadata(RAW_METADATA, { canSeeMoney: true });
const lead = projectCalendarMetadata(RAW_METADATA, { canSeeMoney: false });

check(
  "an OWNER/ADMIN payload is byte-identical — nothing regressed for them",
  admin,
  RAW_METADATA
);
ok(
  "…and is the very same object, so the admin path costs nothing",
  admin === RAW_METADATA
);

for (const key of REDACTED_CALENDAR_KEYS) {
  check(`${key} is nulled for a viewer without money rights`, lead[key], null);
}
check(
  "every redacted key is NULLED, not deleted (priceLabel/payLabel read null safely)",
  REDACTED_CALENDAR_KEYS.every((k) => k in lead),
  true
);
check(
  "the billing line is stripped from notes but the access instruction survives",
  lead.notes,
  "Gate code 4455, dog is friendly"
);
check(
  "operational metadata is untouched",
  [lead.jobId, lead.status, lead.location, lead.employeeName, lead.priorityLabel],
  ["j1", "SCHEDULED", "1234 Rue Wellington, Verdun", "Ann", "ROUTINE"]
);
check("the crew still travels — the point of the view", lead.cleaners, RAW_METADATA.cleaners);
check(
  "Stage 8: an hourly job still reads as hourly, with its hours, minus the rate",
  [lead.billingType, lead.billedHours, lead.billedHourlyRate],
  ["HOURLY", 4, null]
);
check(
  "a note that is ONLY billing text collapses to null, not to an empty string",
  projectCalendarMetadata({ ...RAW_METADATA, notes: "Final amount CAD: 208.52" }, { canSeeMoney: false }).notes,
  null
);
check(
  "a null note stays null",
  projectCalendarMetadata({ ...RAW_METADATA, notes: null }, { canSeeMoney: false }).notes,
  null
);
ok("the input object is never mutated", RAW_METADATA.price === 186.5);

// ── The list can't fall behind the payload ────────────────────────────────
// Every money-ish column in CALENDAR_JOB_SELECT that reaches `metadata` must be
// on the redaction list. This is what stops the next added column leaking.
const MONEY_COLUMNS = [
  "price",
  "employeePay",
  "totalTip",
  "parking",
  "paymentReceived",
  "invoiceSent",
  // Stage 8 — the customer's hourly rate is a price like any other.
  "billedHourlyRate",
];
for (const col of MONEY_COLUMNS) {
  ok(
    `${col} is selected by the calendar AND on the redaction list`,
    new RegExp(`\\b${col}:\\s*(true|job\\.)`).test(CAL_SELECT + FOR_DAY) &&
      (REDACTED_CALENDAR_KEYS as readonly string[]).includes(col)
  );
}
// The three pricing inputs behind `activeSubtotal` are selected but never put
// into metadata under their own names — only the computed `price` is, and that
// is redacted. Assert they don't appear as metadata keys.
for (const col of ["discountAmount", "subtotalAmount", "addOns"]) {
  ok(
    `${col} is never emitted as its own metadata key`,
    !new RegExp(`metadata[\\s\\S]{0,2000}?\\n\\s+${col}:`).test(FOR_DAY)
  );
}

ok(
  "the scope module owns BOTH decisions, so neither can be applied alone",
  /canSeeMoney/.test(SCOPE) && /calendarScopeFilter/.test(SCOPE)
);
ok(
  "money rights and job scope are separate role lists, not one boolean",
  /CALENDAR_ALL_ROLES/.test(SCOPE) && /CALENDAR_MONEY_ROLES/.test(SCOPE)
);
ok(
  "OPS_MANAGER was NOT quietly widened to the whole calendar",
  /const CALENDAR_ALL_ROLES = \["OWNER", "ADMIN"\]/.test(SCOPE)
);
ok(
  "FIELD_LEAD gets the GROUP scope",
  /role === "FIELD_LEAD"[\s\S]{0,400}fieldLeadGroupIds\(viewerId\)/.test(SCOPE)
);
ok(
  "the group is resolved server-side, never taken from the caller",
  /resolveCalendarViewer\(\): Promise<CalendarViewer>/.test(SCOPE) &&
    !/resolveCalendarViewer\((?!\))/.test(SCOPE)
);

// Both feeds must go through the projection. The old ad-hoc session/isAdmin
// plumbing must be gone from both.
for (const [name, src] of [
  ["getJobsForDay", FOR_DAY],
  ["getJobsForCalendar", FOR_CAL],
] as const) {
  ok(`${name} resolves the viewer through _calendarScope`, /resolveCalendarViewer\(\)/.test(src));
  ok(`${name} builds metadata through projectCalendarMetadata`, /projectCalendarMetadata\(/.test(src));
  ok(
    `${name} no longer rolls its own isAdmin role check`,
    !/role === "ADMIN"/.test(src) && !/role === "OWNER"/.test(src)
  );
  // Comments stripped: getJobsForDay's prose still explains the per-day fan-out
  // it replaced, which mentioned getSession.
  ok(
    `${name} no longer reads the session directly`,
    !/auth\.api\.getSession/.test(stripComments(src)) &&
      !/from "@\/lib\/auth"/.test(src)
  );
}
ok(
  "toCalendarEvent REQUIRES a viewer — a leak can't be the default path",
  /viewer: Pick<CalendarViewer, "canSeeMoney">\s*\n?\s*\)/.test(FOR_DAY) &&
    !/viewer\?\s*:/.test(FOR_DAY)
);
ok(
  "the retired requireCalendarViewer helper is gone",
  !/requireCalendarViewer/.test(FOR_DAY)
);

// The badge flag was renamed because `isAdmin` had become a three-way overload.
ok("the kit-badge flag is named for what it decides", /allAssignedCleaners/.test(BADGES));
ok("…and no isAdmin option survives in the badge module", !/opts\.isAdmin/.test(BADGES));
ok(
  "both feeds pass the renamed flag",
  /allAssignedCleaners: viewer\.allAssignedCleaners/.test(FOR_DAY) &&
    /allAssignedCleaners: viewer\.allAssignedCleaners/.test(FOR_CAL)
);

/* ══════════════════════════════════════════════════════════════════════════
   3 · AUTHORIZATION — group membership resolved server-side; writes untouched
   ══════════════════════════════════════════════════════════════════════════ */

ok(
  "there is ONE group resolver, and it is server-only",
  /from "@\/db"/.test(GROUP) && /fieldLeadGroupIds/.test(GROUP)
);
ok(
  "the weekly bonus now shares that resolver instead of re-querying",
  /fieldLeadGroupIds\(fieldLeadId, \{\s*includeArchived: true,?\s*\}\)/.test(BONUS) &&
    !/db\.user\.findMany\(\{\s*where: \{ fieldLeadId \}/.test(BONUS)
);
ok(
  "…with includeArchived: true, preserving the bonus's historical member set",
  /includeArchived: true/.test(BONUS)
);
ok(
  "the My Team surfaces use the default (active members only)",
  /fieldLeadGroupMembers\(gate\.leadId\)/.test(GET_TEAM) &&
    !/includeArchived/.test(GET_TEAM)
);
ok(
  "the group resolver is documented against the role-vs-tier trap",
  /cleanerTier = FIELD_LEAD/.test(GROUP) && /role = FIELD_LEAD/.test(GROUP)
);
ok(
  "the group resolver selects NO pay column",
  !/payMultiplier|ragCredits|padCredits|employeePay/.test(stripComments(GROUP))
);

// getMyTeam: a lead cannot name someone else's group.
ok(
  "a FIELD_LEAD's own id wins — the leadId argument is ignored for them",
  /if \(role === "FIELD_LEAD"\) \{\s*\n\s*return \{ ok: true, leadId: userId/.test(GET_TEAM)
);
ok(
  "OWNER/ADMIN must name a lead explicitly (no implicit 'my group')",
  /Pick a Field Lead to view/.test(GET_TEAM)
);
ok("every other role is refused", /return \{ ok: false, error: "Not authorized" \}/.test(GET_TEAM));
ok(
  "OPS_MANAGER is not admitted to the My Team view",
  !/OPS_MANAGER/.test(GET_TEAM.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ""))
);
ok(
  "every getMyTeam query is filtered by the resolved group",
  /fieldLeadScopedJobsWhere\(groupIds\)/.test(GET_TEAM) &&
    /employeeId: \{ in: groupIds \}/.test(GET_TEAM)
);
ok(
  "getMyTeam performs no write of any kind",
  !/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(GET_TEAM)
);
ok(
  "listFieldLeads is OWNER/ADMIN-only — a lead never gets a roster of leads",
  /role !== "OWNER" && role !== "ADMIN"\) return \[\]/.test(GET_TEAM)
);
// The role-vs-tier trap, found in live data by probe-stage7-field-lead.ts: the
// only group in the database belongs to a lead whose ROLE is EMPLOYEE, so they
// cannot open /admin/my-team at all. The picker must list that group anyway (an
// admin has to be able to inspect it) and must say why the lead can't.
ok(
  "the lead picker lists groups by 'someone points at me', not by role or tier",
  /groupMembers: \{ some: \{ deletedAt: null \} \}/.test(GET_TEAM) &&
    !/cleanerTier: "FIELD_LEAD"/.test(GET_TEAM)
);
ok(
  "…and reports whether each lead can open the page themselves",
  /canOpenOwnView: r\.role === "FIELD_LEAD"/.test(GET_TEAM)
);
ok(
  "…which the picker surfaces, with the role/tier distinction explained",
  /!lead\.canOpenOwnView/.test(TEAM_PAGE) &&
    /two independent columns/.test(TEAM_PAGE)
);

// Availability: reads widen, writes do not.
ok(
  "getAvailability lets a FIELD_LEAD read a GROUP MEMBER, checked against the DB",
  /role === "FIELD_LEAD" &&\s*\n?\s*\(await isFieldLeadGroupMember\(session\.user\.id, targetId\)\)/.test(
    GET_AVAIL
  )
);
ok(
  "…and still fails closed for every other non-admin role",
  /if \(!allowed\) return \{ success: false, error: "Not authorized" \}/.test(GET_AVAIL)
);
ok("getGroupAvailability exists as its own read path", /export async function getGroupAvailability/.test(GET_AVAIL));
ok(
  "listAvailabilityEmployees stays OWNER/ADMIN-only (its picker leads to a write)",
  /if \(role !== "OWNER" && role !== "ADMIN"\) return \[\];/.test(GET_AVAIL)
);
ok(
  "setAvailability was NOT widened — still OWNER/ADMIN",
  /const isAdmin = role === "OWNER" \|\| role === "ADMIN";/.test(SET_AVAIL) &&
    !/FIELD_LEAD/.test(SET_AVAIL)
);
ok(
  "availabilityExceptions writes were NOT widened",
  /const isAdmin = role === "OWNER" \|\| role === "ADMIN";/.test(AVAIL_EXC) &&
    !/FIELD_LEAD/.test(AVAIL_EXC)
);
ok(
  "checkAvailability gates on an id ALLOW-LIST, not on a bare isStaff boolean",
  /allowedIds: Set<string> \| null/.test(CHECK_AVAIL) && /function mayQuery/.test(CHECK_AVAIL)
);
ok(
  "…and the FIELD_LEAD allow-list is their group, resolved from the DB",
  /fieldLeadGroupIds\(userId\)/.test(CHECK_AVAIL)
);
ok(
  "FIELD_LEAD is NOT staff there — the assignment-conflict preview stays closed",
  /STAFF_ROLES = \["OWNER", "ADMIN", "OPS_MANAGER"\]/.test(CHECK_AVAIL) &&
    /if \(!g\.isStaff\) return \{ success: false, error: "Not authorized" \};/.test(CHECK_AVAIL)
);
ok(
  "both lookup entry points go through the allow-list",
  (CHECK_AVAIL.match(/mayQuery\(g,/g) ?? []).length === 2
);

// Pages that used to lean on the layout alone.
ok(
  "/admin/employees carries an explicit OWNER/ADMIN page guard",
  /await requireOwnerAdmin\(\);/.test(EMPLOYEES_PAGE)
);
ok(
  "…and no longer hand-rolls the redirect",
  !/redirect\("\/admin\/dashboard"\)/.test(EMPLOYEES_PAGE)
);
ok(
  "/admin/analytics carries an explicit OWNER/ADMIN page guard",
  /await requireOwnerAdmin\(\);/.test(ANALYTICS_PAGE)
);
ok(
  "…and the unreachable EMPLOYEE-only check that let FIELD_LEAD in is gone",
  !/role === "EMPLOYEE"\) \{\s*\n\s*redirect/.test(ANALYTICS_PAGE)
);
ok(
  "both guarded pages are marked adminOnly in the nav, matching their guard",
  /href: "\/admin\/employees",[\s\S]{0,120}adminOnly: true/.test(SIDEBAR) &&
    /href: "\/admin\/analytics",[\s\S]{0,120}adminOnly: true/.test(SIDEBAR)
);

// Dashboard: the page a FIELD_LEAD lands on.
ok(
  "the dashboard decides money visibility once",
  /const canSeeMoney = role === "OWNER" \|\| role === "ADMIN";/.test(DASHBOARD_PAGE)
);
ok(
  "the revenue/scheduled-value queries are SKIPPED, not computed and hidden",
  /canSeeMoney \? getTotalRevenue\(\) : Promise\.resolve\(0\)/.test(DASHBOARD_PAGE) &&
    /canSeeMoney \? getScheduledValue\(\) : Promise\.resolve\(0\)/.test(DASHBOARD_PAGE)
);
ok(
  "the two money tiles render only for OWNER/ADMIN",
  /\{canSeeMoney && \(\s*\n\s*<>[\s\S]{0,400}Total revenue collected/.test(DASHBOARD_PAGE)
);
ok(
  "the per-job price in both dashboard lists is money-gated",
  /showMoney: boolean;/.test(DASHBOARD_PAGE) &&
    (DASHBOARD_PAGE.match(/showMoney=\{canSeeMoney\}/g) ?? []).length === 2 &&
    /\{showMoney && \(/.test(DASHBOARD_PAGE)
);
ok(
  "the collections tile is money-gated too",
  /canSeeMoney && pendingPaymentJobs > 0/.test(DASHBOARD_PAGE)
);
ok(
  "the inventory quick action drops its value but keeps the product count",
  /canSeeMoney\s*\n?\s*\? `\$\{totalProducts\} products · \$\{money\(totalInventoryValue\)\}`/.test(
    DASHBOARD_PAGE
  )
);
ok(
  "a FIELD_LEAD's Employees tile points at My Team, not at a page that bounces them",
  /role === "FIELD_LEAD"[\s\S]{0,200}href: "\/admin\/my-team"/.test(DASHBOARD_PAGE)
);
ok(
  "the operational tiles are NOT gated (this is a redaction, not a lockout)",
  /label="Today's jobs"/.test(DASHBOARD_PAGE) &&
    !/canSeeMoney[\s\S]{0,80}label="Today's jobs"/.test(DASHBOARD_PAGE)
);

/* ══════════════════════════════════════════════════════════════════════════
   4 · DTO PRIVACY — the My Team payload
   ══════════════════════════════════════════════════════════════════════════ */

// The types file is the contract, and it says so.
ok(
  "the DTO documents its omissions as a privacy contract",
  /privacy regression, not a feature/.test(TEAM_TYPES)
);

// The words must be absent from the TYPE DECLARATIONS, not merely unused.
const TEAM_TYPES_CODE = stripComments(TEAM_TYPES);
const FORBIDDEN_DTO_FIELDS = [
  "price",
  "employeePay",
  "hourlyRate",
  "payType",
  "totalTip",
  "parking",
  "paymentReceived",
  "invoiceSent",
  "paymentType",
  "isCashJob",
  "subtotalAmount",
  "discountAmount",
  "refundedAmount",
  "payMultiplier",
  "accessNotes",
  "groupRevenue",
];
for (const field of FORBIDDEN_DTO_FIELDS) {
  ok(
    `the My Team DTO declares no ${field}`,
    !new RegExp(`\\b${field}\\b`, "i").test(TEAM_TYPES_CODE)
  );
}

// Fetching is the real boundary. A column that isn't selected cannot leak, no
// matter what a future mapper edit does.
const GET_TEAM_CODE = stripComments(GET_TEAM);
for (const field of FORBIDDEN_DTO_FIELDS) {
  ok(
    `getMyTeam never SELECTS ${field}`,
    !new RegExp(`${field}:\\s*true`, "i").test(GET_TEAM_CODE)
  );
}
ok(
  "getMyTeam uses an explicit select, not an include (which would pull ~90 columns)",
  /select: \{/.test(GET_TEAM) && !/include: \{/.test(GET_TEAM)
);
ok(
  "notes leave the server sanitized, never raw",
  /notes: sanitizeCleanerNotes\(job\.notes\)/.test(GET_TEAM) &&
    !/notes: job\.notes/.test(GET_TEAM)
);
// ── The two withholding rules, exercised directly ─────────────────────────
// They live in a pure module (src/lib/team-schedule.ts) precisely so they can be
// run here rather than merely grepped for: an untested privacy rule is an
// assumption.
check("a full name is reduced to a first name", clientFirstName("Sarah Chen"), "Sarah");
check("a single-word name passes through", clientFirstName("Sarah"), "Sarah");
check("a three-part name still yields one token", clientFirstName("Maria de la Cruz"), "Maria");
check("extra whitespace doesn't produce an empty name", clientFirstName("   Sarah   Chen "), "Sarah");
check("a missing name falls back to a placeholder, never a blank row", clientFirstName(null), "Client");
check("…and so does an empty/whitespace name", clientFirstName("   "), "Client");

check(
  "the area is the trailing locality",
  addressArea("1234 Rue Wellington, Verdun"),
  "Verdun"
);
check(
  "a longer address still yields the last segment",
  addressArea("1234 Rue Wellington, Apt 3, Verdun, QC"),
  "QC"
);
// THE privacy case: `shortLocation` on the admin calendar would return the
// street here. This must not.
check(
  "a single-segment address yields NO area rather than the bare street",
  addressArea("1234 Rue Wellington"),
  null
);
check("a trailing comma doesn't yield an empty area", addressArea("1234 Rue Wellington, Verdun,"), "Verdun");
check("a null address is null", addressArea(null), null);
check("an empty address is null", addressArea(""), null);
check("a comma-only address is null", addressArea(",,,"), null);

ok(
  "the withholding rules are a PURE module, so this script can run them",
  !/^import /m.test(read("src/lib/team-schedule.ts"))
);
ok(
  "…and the action uses them rather than a private copy",
  /from "@\/lib\/team-schedule"/.test(GET_TEAM) &&
    /clientFirstName\(job\.clientName\)/.test(GET_TEAM) &&
    /addressArea\(job\.location\)/.test(GET_TEAM)
);
ok(
  "the deliberate divergence from the calendar's shortLocation is documented",
  /shortLocation/.test(read("src/lib/team-schedule.ts"))
);
ok(
  "…and the calendar's own shortLocation was NOT changed under it",
  /return parts\[parts\.length - 1\]\.trim\(\);/.test(
    read("src/components/calendar/status-meta.ts")
  )
);
ok("the client gets a first name and an area, not a contact record", /clientFirstName/.test(TEAM_TYPES));

// The rendered client must not print money either.
const TEAM_CLIENT_CODE = stripComments(TEAM_CLIENT);
ok(
  "the My Team client formats no currency at all",
  !/\$\{?money|money\(|toFixed\(2\)|\bprice\b/i.test(TEAM_CLIENT_CODE)
);
ok(
  "PAID is rendered as 'Completed' — whether the client paid is not a lead's business",
  /PAID: "Completed"/.test(TEAM_CLIENT)
);
ok(
  "the availability grid is read-only for a lead: no write action is imported",
  !/setAvailability|addAvailabilityException|removeAvailabilityException/.test(TEAM_CLIENT) &&
    !/setAvailability|addAvailabilityException/.test(TEAM_PAGE)
);
ok(
  "the page states the read-only rule to the user",
  /read-only here/.test(TEAM_CLIENT)
);

// Reuse, not a second implementation, of the availability table.
ok(
  "My Team reuses the Employees page's availability table",
  /from "\.\.\/employees\/AvailabilityOverview"/.test(TEAM_CLIENT)
);
ok(
  "…with profile links OFF, because /admin/employees/[id] is OWNER/ADMIN-only",
  // NARROWED IN STAGE 12, not deleted. The `linkProfiles ? (` ternary this used
  // to look for in AvailabilityOverview moved into the extracted shared grid
  // (`src/components/admin/AvailabilityWeekGrid.tsx`) when /admin/availability
  // was built on the same rendering. The privacy rule is unchanged and still
  // asserted end to end: My Team passes false, the card forwards it, and the
  // grid is the one place that decides between a <Link> and plain text.
  /linkProfiles=\{false\}/.test(TEAM_CLIENT) &&
    /linkProfiles=\{linkProfiles\}/.test(OVERVIEW) &&
    /linkProfiles \? \(/.test(GRID)
);
ok(
  "the card keeps its original defaults (links on, collapsed)",
  /defaultOpen = false/.test(OVERVIEW) && /linkProfiles = true/.test(OVERVIEW)
);
ok(
  "blocked dates travel with the grid, or it would lie about who is free",
  /timeOff/.test(TEAM_TYPES) && /availabilityException\.findMany/.test(GET_TEAM)
);

// Page guard + nav.
ok(
  "the My Team page gates on FIELD_LEAD, with OWNER/ADMIN as the debug path",
  /role !== "FIELD_LEAD" && !isOwnerAdmin/.test(TEAM_PAGE) &&
    /redirect\("\/admin\/dashboard"\)/.test(TEAM_PAGE)
);
ok(
  "an admin viewing a lead's team is told so, so it is never mistaken for their own",
  /viewingAsAdmin/.test(TEAM_PAGE + TEAM_CLIENT) && /as an admin/.test(TEAM_CLIENT)
);
ok(
  "the nav entry is FIELD_LEAD-only",
  /href: "\/admin\/my-team",[\s\S]{0,140}fieldLeadOnly: true/.test(SIDEBAR)
);
ok(
  "…and the filter actually honours fieldLeadOnly",
  /!item\.fieldLeadOnly \|\| isFieldLead/.test(SIDEBAR)
);
ok(
  "adminOnly filtering is unchanged for every other entry",
  /!item\.adminOnly \|\| isOwnerAdmin/.test(SIDEBAR)
);

// Timezone discipline — the repo's standing rule.
ok(
  "the schedule buckets days in the BUSINESS timezone, not the host's",
  /storeDayRange\(now\)/.test(GET_TEAM) &&
    /storeDateKey\(/.test(GET_TEAM) &&
    /addStoreDays\(start,/.test(GET_TEAM)
);
ok(
  "…and never uses a raw Date day boundary",
  !/setHours\(0, 0, 0, 0\)/.test(GET_TEAM)
);
// The horizon is one constant with no second copy. It lives in the types file
// because a `"use server"` module may only export async functions — exporting a
// plain const from the action fails the build outright.
ok(
  "the horizon is 14 days per PDF #7, declared once in the types module",
  /export const SCHEDULE_HORIZON_DAYS = 14;/.test(TEAM_TYPES)
);
ok(
  "…and the action imports it rather than restating the number",
  !/\b14\b/.test(GET_TEAM_CODE) &&
    // Query bound, day loop, and the payload's horizonDays: three reads.
    (GET_TEAM_CODE.match(/SCHEDULE_HORIZON_DAYS/g) ?? []).length >= 4
);
ok(
  "…and the UI reads it off the payload, so its copy can't quote a different number",
  /team\.horizonDays/.test(TEAM_CLIENT) && !/\b14\b/.test(stripComments(TEAM_CLIENT))
);
ok(
  "the job query is capped so a mis-set fieldLeadId can't become a full scan",
  /MAX_JOBS/.test(GET_TEAM) && /take: MAX_JOBS/.test(GET_TEAM)
);
ok(
  "cancelled work is not presented as a schedule",
  /status: \{ not: "CANCELLED" \}/.test(GET_TEAM)
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
