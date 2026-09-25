// Sample data for the manager side, in development builds only. Never bundled
// into a release (see ./index.ts). Held in memory, so a crew change, an
// approval or a resolved problem sticks while the preview is open.
//
// It answers as the server would for the preview's signed-in role
// (./role.ts): a capability the role doesn't have is 403, and a field lead
// sees only their group (Sofia Martins leads Amara, Jean and Kofi), by the
// rules in @bookmops/api/v1 manager-access.ts.
//
// To see a refusal: approving Kofi's cloth request is "warehouse short", and
// a crew of Kofi alone is refused as an unpaired trainee. Nobody sees their
// own clock time, withdrawal or kit request in a queue (Sofia's clock time is
// there for the office, not for her), and a field lead sees only their
// group's clock times, with the client's first name.
import { ApiError } from "@bookmops/api/client";
import {
  type Alert,
  type Candidate,
  can,
  type CrewMember,
  type CrewState,
  type JobAttention,
  type KitRequestItem,
  type LateArrival,
  type ManagedIssue,
  type ManagedWithdrawal,
  type ManagerCapability,
  type ManagerJobResponse,
  type OfficeConversation,
  type OfficeMessage,
  teamScopeFor,
  type TeamJob,
  type TimeItem,
} from "@bookmops/api/v1";

import type { DataSource } from "../source";
import { delay } from "./delay";
import { previewPerson, previewRole } from "./role";

const TZ = "America/Toronto";
const PAGE = 20;

// ---- Helpers -------------------------------------------------------------------------

const minutes = (m: number) => new Date(Date.now() + m * 60_000);
function at(minutesFromNow: number, roundTo = 5): string {
  const d = minutes(minutesFromNow);
  d.setUTCMinutes(Math.round(d.getUTCMinutes() / roundTo) * roundTo, 0, 0);
  return d.toISOString();
}

const dateKeyOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

/** A wall-clock time on a company day, as an instant. */
function zoned(dateKey: string, hour: number, minute = 0): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hour, minute);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(guess - (asUtc - guess)).toISOString();
}

function pageOf<T>(items: readonly T[], cursor?: string | null) {
  const start = cursor ? Number(cursor) : 0;
  return { items: items.slice(start, start + PAGE), nextCursor: start + PAGE < items.length ? String(start + PAGE) : null };
}

const forbidden = () => new ApiError("Your role can't do this. Ask an admin.", 403, "FORBIDDEN", false);
const notFound = (what = "This") => new ApiError(`${what} isn't available.`, 404, "NOT_FOUND", false);
const refuse = (code: string, message: string) => new ApiError(message, 409, code, false);
const selfApproval = () => new ApiError("That one is yours, so someone else in the office decides it.", 403, "SELF_APPROVAL", false);
const isMe = (personId: string) => personId === previewPerson().id;

function guard(...any: ManagerCapability[]) {
  if (!any.some((c) => can(previewRole(), c))) throw forbidden();
}

/** A replayed clientEventId answers what the first one did, as the server's IdempotencyRecord. */
const replays = new Map<string, unknown>();
async function once<T>(key: string, run: () => T | Promise<T>): Promise<T> {
  await delay(null, 450);
  if (replays.has(key)) return replays.get(key) as T;
  const out = await run();
  replays.set(key, out);
  return out;
}

// ---- The people ----------------------------------------------------------------------

type Tier = "TRAINEE" | "STANDARD" | "FIELD_LEAD";
interface Person {
  id: string;
  name: string;
  tier: Tier;
  /** How this person's availability reads against any job, for the sample. */
  availability: Candidate["availability"];
  dayOff?: string;
  warning?: string;
}

const PEOPLE: Person[] = [
  { id: "preview-cleaner", name: "Amara Diallo", tier: "STANDARD", availability: "AVAILABLE" },
  { id: "u-sofia", name: "Sofia Martins", tier: "FIELD_LEAD", availability: "AVAILABLE" },
  { id: "u-jean", name: "Jean Morin", tier: "STANDARD", availability: "AVAILABLE" },
  { id: "u-lucie", name: "Lucie Paquette", tier: "STANDARD", availability: "UNAVAILABLE", dayOff: "Vacation" },
  {
    id: "u-thomas",
    name: "Thomas Nguyen",
    tier: "STANDARD",
    availability: "OUTSIDE_HOURS",
    warning: "Thomas Nguyen is being assigned outside their availability — available 12:00–18:00 that day",
  },
  { id: "u-kofi", name: "Kofi Mensah", tier: "TRAINEE", availability: "AVAILABLE" },
  { id: "u-priya", name: "Priya Nair", tier: "STANDARD", availability: "NO_DATA" },
  { id: "u-elise", name: "Élise Gagnon", tier: "STANDARD", availability: "AVAILABLE", warning: "Élise Gagnon is not approved for Deep clean work" },
];
const person = (id: string) => PEOPLE.find((p) => p.id === id);

/** Sofia Martins' field-lead group, resolved "server-side". */
const GROUP = new Set(["u-sofia", "preview-cleaner", "u-jean", "u-kofi"]);

function warningsFor(p: Person): string[] {
  const out: string[] = [];
  if (p.dayOff) out.push(`${p.name} has this date blocked off (${p.dayOff})`);
  if (p.warning) out.push(p.warning);
  return out;
}

// ---- Jobs ----------------------------------------------------------------------------

interface CrewSeed {
  id: string;
  state: Exclude<CrewState, "LATE">;
  clockedInAt: string | null;
  clockedOutAt: string | null;
  minutesLate: number | null;
  onBreakSince?: string;
}

interface JobSeed {
  id: string;
  jobNumber: number;
  startsAt: string;
  endsAt: string | null;
  isFlexible: boolean;
  status: TeamJob["status"];
  address: TeamJob["address"];
  client: { name: string; phone: string | null; email: string | null };
  service: TeamJob["service"];
  required: number;
  leadId: string | null;
  crew: CrewSeed[];
  notes: string | null;
  checklist: { done: number; total: number };
}

const waiting = (id: string): CrewSeed => ({ id, state: "NOT_STARTED", clockedInAt: null, clockedOutAt: null, minutesLate: null });
const working = (id: string, inAt: string, late = 0): CrewSeed => ({ id, state: "CLOCKED_IN", clockedInAt: inAt, clockedOutAt: null, minutesLate: late });
const finished = (id: string, inAt: string, outAt: string): CrewSeed => ({ id, state: "DONE", clockedInAt: inAt, clockedOutAt: outAt, minutesLate: 0 });

const DEEP = { category: "DEEP", label: "Deep clean" };
const STANDARD = { category: "RESIDENTIAL", label: "Standard clean" };
const MOVE = { category: "MOVE_OUT", label: "Move-out clean" };

function todaysJobs(): JobSeed[] {
  return [
    {
      id: "m-100",
      jobNumber: 1430,
      startsAt: at(-330),
      endsAt: at(-180),
      isFlexible: false,
      status: "COMPLETED",
      address: { line1: "300 rue Rachel Est", line2: null, area: "Le Plateau" },
      client: { name: "Hélène Bouchard", phone: "+1 514 555 0142", email: "helene@example.com" },
      service: STANDARD,
      required: 1,
      leadId: "u-thomas",
      crew: [finished("u-thomas", at(-332), at(-178))],
      notes: null,
      checklist: { done: 16, total: 16 },
    },
    {
      id: "m-101",
      jobNumber: 1431,
      startsAt: at(-120),
      endsAt: at(60),
      isFlexible: false,
      status: "IN_PROGRESS",
      address: { line1: "4218 rue Saint-Denis", line2: "Apt 3", area: "Le Plateau" },
      client: { name: "Claire Fontaine", phone: "+1 514 555 0110", email: "claire@example.com" },
      service: DEEP,
      required: 2,
      leadId: "u-sofia",
      crew: [working("u-sofia", at(-122)), working("preview-cleaner", at(-118))],
      notes: "Buzzer 3 · key in the lockbox, code 4821. Two cats: keep the bedroom door closed.",
      checklist: { done: 11, total: 18 },
    },
    {
      id: "m-106",
      jobNumber: 1436,
      startsAt: at(-75),
      endsAt: at(45),
      isFlexible: false,
      status: "IN_PROGRESS",
      address: { line1: "1250 boul. René-Lévesque", line2: "Suite 1400", area: "Ville-Marie" },
      client: { name: "Northwind Studio", phone: "+1 514 555 0199", email: "office@example.com" },
      service: STANDARD,
      required: 1,
      leadId: "u-elise",
      crew: [{ ...working("u-elise", at(-58), 17), state: "ON_BREAK", onBreakSince: at(-8) }],
      notes: "Office clean. Sign in at the front desk.",
      checklist: { done: 6, total: 14 },
    },
    {
      id: "m-102",
      jobNumber: 1432,
      startsAt: at(-20),
      endsAt: at(100),
      isFlexible: false,
      status: "SCHEDULED",
      address: { line1: "77 av. Duluth Est", line2: "Unit 2", area: "Le Plateau" },
      client: { name: "Marc-André Roy", phone: "+1 514 555 0168", email: null },
      service: STANDARD,
      required: 1,
      leadId: "u-jean",
      crew: [waiting("u-jean")],
      notes: "Client works from home; ring twice.",
      checklist: { done: 0, total: 16 },
    },
    {
      id: "m-103",
      jobNumber: 1433,
      startsAt: at(60),
      endsAt: at(240),
      isFlexible: false,
      status: "SCHEDULED",
      address: { line1: "5 rue Sherbrooke Ouest", line2: null, area: "Westmount" },
      client: { name: "Olivia Chen", phone: "+1 514 555 0187", email: "olivia@example.com" },
      service: MOVE,
      required: 2,
      leadId: "u-lucie",
      crew: [waiting("u-lucie")],
      notes: "Empty unit. Concierge has the key.",
      checklist: { done: 0, total: 22 },
    },
    {
      id: "m-104",
      jobNumber: 1434,
      startsAt: at(180),
      endsAt: at(300),
      isFlexible: false,
      status: "SCHEDULED",
      address: { line1: "6620 rue Saint-Hubert", line2: null, area: "Rosemont" },
      client: { name: "Samuel Tremblay", phone: null, email: "sam@example.com" },
      service: STANDARD,
      required: 1,
      leadId: null,
      crew: [],
      notes: null,
      checklist: { done: 0, total: 16 },
    },
    {
      id: "m-105",
      jobNumber: 1435,
      startsAt: at(270),
      endsAt: at(420),
      isFlexible: true,
      status: "SCHEDULED",
      address: { line1: "3470 av. Laval", line2: null, area: "Le Plateau" },
      client: { name: "Isabelle Martin", phone: "+1 514 555 0133", email: null },
      service: DEEP,
      required: 2,
      leadId: "u-priya",
      crew: [waiting("u-priya"), waiting("u-kofi")],
      notes: "Flexible: any time today.",
      checklist: { done: 0, total: 18 },
    },
  ];
}

const AREAS = ["Le Plateau", "Mile End", "Verdun", "Rosemont", "Westmount", "Outremont"];
const STREETS = ["88 rue Fairmount", "4410 av. de l'Esplanade", "212 rue Wellington", "5190 boul. Saint-Laurent", "31 av. Bernard"];

/** Another day: a few plain jobs, the same every time that day is opened. */
function otherDay(key: string): JobSeed[] {
  const seed = Number(key.replaceAll("-", "")) % 97;
  const past = key < dateKeyOf(new Date());
  const count = 2 + (seed % 3);
  return Array.from({ length: count }, (_, i) => {
    const who = PEOPLE[(seed + i * 3) % PEOPLE.length]!;
    const start = zoned(key, 8 + i * 3);
    const end = zoned(key, 10 + i * 3, 30);
    return {
      id: `m-${key}-${i}`,
      jobNumber: 1500 + seed * 4 + i,
      startsAt: start,
      endsAt: end,
      isFlexible: false,
      status: past ? "COMPLETED" : "SCHEDULED",
      address: { line1: STREETS[(seed + i) % STREETS.length]!, line2: null, area: AREAS[(seed + i) % AREAS.length]! },
      client: { name: ["Nora Blake", "Luc Gagné", "Aisha Karim", "Paul Leroux"][(seed + i) % 4]!, phone: null, email: null },
      service: i % 2 ? DEEP : STANDARD,
      required: 1,
      leadId: i === count - 1 && !past ? null : who.id,
      crew: i === count - 1 && !past ? [] : [past ? finished(who.id, start, end) : waiting(who.id)],
      notes: null,
      checklist: { done: past ? 16 : 0, total: 16 },
    } satisfies JobSeed;
  });
}

const days = new Map<string, JobSeed[]>();
function jobsOn(key: string): JobSeed[] {
  let list = days.get(key);
  if (!list) {
    list = key === dateKeyOf(new Date()) ? todaysJobs() : otherDay(key);
    days.set(key, list);
  }
  return list;
}

function findJob(id: string): JobSeed | undefined {
  jobsOn(dateKeyOf(new Date()));
  for (const list of days.values()) {
    const j = list.find((x) => x.id === id);
    if (j) return j;
  }
  return undefined;
}

// ---- Issues (per job) ---------------------------------------------------------------

const issues: ManagedIssue[] = [
  {
    id: "i-1",
    job: { id: "m-102", jobNumber: 1432, clientName: "Marc-André Roy", startsAt: at(-20) },
    reportedBy: "Jean Morin",
    category: "ACCESS",
    urgency: "URGENT",
    status: "OPEN",
    note: "Lockbox code on file doesn't open it. Waiting outside; client isn't answering.",
    photoUrl: null,
    reportedAt: at(-6, 1),
    acknowledgedAt: null,
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
  },
  {
    id: "i-2",
    job: { id: "m-101", jobNumber: 1431, clientName: "Claire Fontaine", startsAt: at(-120) },
    reportedBy: "Sofia Martins",
    category: "SUPPLIES",
    urgency: "NORMAL",
    status: "ACKNOWLEDGED",
    note: "Oven cleaner ran out halfway. Finishing with degreaser.",
    photoUrl: null,
    reportedAt: at(-50, 1),
    acknowledgedAt: at(-44, 1),
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
  },
  {
    id: "i-3",
    job: { id: "m-100", jobNumber: 1430, clientName: "Hélène Bouchard", startsAt: at(-330) },
    reportedBy: "Thomas Nguyen",
    category: "PROPERTY",
    urgency: "NORMAL",
    status: "RESOLVED",
    note: "Small chip on the bathroom tile, was there before we started.",
    photoUrl: null,
    reportedAt: at(-300, 1),
    acknowledgedAt: at(-290, 1),
    resolvedAt: at(-280, 1),
    resolvedBy: "Marc Tremblay",
    resolutionNote: "Noted on the client's file, thanks for flagging it before starting.",
  },
];

// ---- Projection, by role -------------------------------------------------------------

function crewState(c: CrewSeed, job: JobSeed): CrewState {
  if (c.state === "NOT_STARTED" && !job.isFlexible && new Date(job.startsAt).getTime() < Date.now()) return "LATE";
  return c.state;
}

function inScope(job: JobSeed): boolean {
  if (teamScopeFor(previewRole()) === "COMPANY") return true;
  if (teamScopeFor(previewRole()) === "GROUP") return job.crew.some((c) => GROUP.has(c.id)) || (!!job.leadId && GROUP.has(job.leadId));
  return false;
}

function toTeamJob(job: JobSeed): TeamJob {
  const lead = previewRole() === "FIELD_LEAD";
  const onIt = job.crew.some((c) => c.id === previewPerson().id);
  const crew: CrewMember[] = job.crew.map((c) => {
    const p = person(c.id)!;
    return {
      id: c.id,
      name: p.name,
      isLead: job.leadId === c.id,
      tier: p.tier,
      state: crewState(c, job),
      assignment: c.state === "DONE" ? "CLOCKED_OUT" : c.state === "NOT_STARTED" ? "ASSIGNED" : "CLOCKED_IN",
      clockedInAt: c.clockedInAt,
      clockedOutAt: c.clockedOutAt,
      minutesLate: c.minutesLate,
    };
  });
  const attention: JobAttention[] = [];
  if (job.crew.length === 0) attention.push("UNASSIGNED");
  else if (job.crew.length < job.required) attention.push("SHORT_STAFFED");
  if (crew.some((c) => c.state === "LATE")) attention.push("LATE_START");
  if (issues.some((i) => i.job.id === job.id && i.status !== "RESOLVED")) attention.push("ISSUE_OPEN");
  return {
    id: job.id,
    jobNumber: job.jobNumber,
    startsAt: job.startsAt,
    endsAt: job.endsAt,
    isFlexible: job.isFlexible,
    status: job.status,
    address: lead && !onIt ? { ...job.address, line1: null, line2: null } : job.address,
    client: { name: lead ? job.client.name.split(" ")[0]! : job.client.name },
    service: job.service,
    staffing: { required: job.required, assigned: job.crew.length },
    crew,
    attention,
  };
}

const PRESSING: CrewState[] = ["LATE", "ON_BREAK", "CLOCKED_IN", "NOT_STARTED", "DONE"];

function jobDetail(job: JobSeed): ManagerJobResponse {
  const role = previewRole();
  const base = toTeamJob(job);
  const records = can(role, "JOB_RECORDS");
  const events: NonNullable<ManagerJobResponse["clockEvents"]> = [];
  if (records) {
    for (const c of job.crew) {
      const name = person(c.id)!.name;
      if (c.clockedInAt) events.push({ kind: "CLOCK_IN", cleanerId: c.id, cleanerName: name, at: c.clockedInAt, pendingReview: c.id === "u-jean" });
      if (c.onBreakSince) events.push({ kind: "BREAK_START", cleanerId: c.id, cleanerName: name, at: c.onBreakSince, pendingReview: false });
      if (c.clockedOutAt) events.push({ kind: "CLOCK_OUT", cleanerId: c.id, cleanerName: name, at: c.clockedOutAt, pendingReview: false });
    }
    events.sort((a, b) => a.at.localeCompare(b.at));
  }
  return {
    ...base,
    client: {
      name: base.client.name,
      phone: can(role, "JOB_CONTACT") ? job.client.phone : null,
      email: can(role, "JOB_CONTACT") ? job.client.email : null,
    },
    notes: job.notes,
    clockEvents: records ? events : null,
    photos: records ? [] : null,
    checklist: records ? job.checklist : null,
    issues: records
      ? issues
          .filter((i) => i.job.id === job.id)
          .map((i) => ({ id: i.id, category: i.category, urgency: i.urgency, status: i.status, note: i.note, reportedBy: i.reportedBy, reportedAt: i.reportedAt }))
      : null,
    can: { setCrew: can(role, "CREW_SET"), addCleaner: can(role, "CREW_ADD") },
  };
}

function scopedJob(id: string): JobSeed {
  const job = findJob(id);
  if (!job || !inScope(job)) throw notFound("This job");
  return job;
}

/** The warnings a crew change would override: the people being added. */
function warningsForAdding(job: JobSeed, ids: readonly string[]): string[] {
  const before = new Set(job.crew.map((c) => c.id));
  return ids.filter((id) => !before.has(id)).flatMap((id) => warningsFor(person(id)!));
}

// ---- Approvals -----------------------------------------------------------------------

const timeItems: TimeItem[] = [
  {
    id: "t-1",
    kind: "OFFLINE_CLOCK",
    status: "PENDING",
    cleaner: { id: "u-jean", name: "Jean Morin" },
    job: { id: "m-100", jobNumber: 1430, clientName: "Hélène Bouchard", startsAt: at(-330) },
    current: { start: at(-312, 1), end: at(-178, 1) },
    requested: { start: at(-331, 1), end: null },
    reason: null,
    offline: { event: "CLOCK_IN", why: "GAP_OVER_LIMIT", occurredAt: at(-331, 1), receivedAt: at(-312, 1) },
    createdAt: at(-312, 1),
    decided: null,
  },
  {
    id: "t-2",
    kind: "CLEANER_REQUEST",
    status: "PENDING",
    cleaner: { id: "u-lucie", name: "Lucie Paquette" },
    job: { id: "m-prev-1", jobNumber: 1419, clientName: "Olivia Chen", startsAt: at(-60 * 26) },
    current: { start: at(-60 * 26, 1), end: at(-60 * 23 - 50, 1) },
    requested: { start: null, end: at(-60 * 23 + 5, 1) },
    reason: "Forgot to clock out. I stayed to finish the oven, the client can confirm.",
    offline: null,
    createdAt: at(-60 * 20, 1),
    decided: null,
  },
  {
    id: "t-3",
    kind: "OFFLINE_CLOCK",
    status: "PENDING",
    cleaner: { id: "preview-cleaner", name: "Amara Diallo" },
    job: { id: "m-prev-2", jobNumber: 1421, clientName: "Claire Fontaine", startsAt: at(-60 * 28) },
    current: { start: at(-60 * 28, 1), end: at(-60 * 25 + 7, 1) },
    requested: { start: null, end: at(-60 * 25 - 14, 1) },
    reason: null,
    offline: { event: "CLOCK_OUT", why: "NOT_PROVEN_OFFLINE", occurredAt: at(-60 * 25 - 14, 1), receivedAt: at(-60 * 25 + 7, 1) },
    createdAt: at(-60 * 25 + 7, 1),
    decided: null,
  },
  {
    id: "t-5",
    kind: "CLEANER_REQUEST",
    status: "PENDING",
    cleaner: { id: "u-sofia", name: "Sofia Martins" },
    job: { id: "m-prev-4", jobNumber: 1424, clientName: "Isabelle Martin", startsAt: at(-60 * 50) },
    current: { start: at(-60 * 50, 1), end: at(-60 * 47, 1) },
    requested: { start: at(-60 * 50 - 15, 1), end: null },
    reason: "I opened up 15 minutes early to let the plumber in.",
    offline: null,
    createdAt: at(-60 * 46, 1),
    decided: null,
  },
  {
    id: "t-4",
    kind: "CLEANER_REQUEST",
    status: "APPROVED",
    cleaner: { id: "u-thomas", name: "Thomas Nguyen" },
    job: { id: "m-prev-3", jobNumber: 1410, clientName: "Nora Blake", startsAt: at(-60 * 74) },
    current: { start: at(-60 * 74 + 10, 1), end: at(-60 * 71, 1) },
    requested: { start: at(-60 * 74 + 10, 1), end: null },
    reason: "The app froze at the door. I started at 9:10.",
    offline: null,
    createdAt: at(-60 * 70, 1),
    decided: { by: "Marc Tremblay", at: at(-60 * 50, 1), note: null },
  },
];

/**
 * The time items the caller could decide: never their own, and for a field
 * lead only their group's (manager-approvals.ts, TimeItemsResponse).
 */
function timeInReach(t: TimeItem): boolean {
  if (isMe(t.cleaner.id)) return false;
  return teamScopeFor(previewRole()) !== "GROUP" || GROUP.has(t.cleaner.id);
}

/** A time item as the caller sees it: a field lead gets the client's first name only. */
function asSeen(t: TimeItem): TimeItem {
  if (previewRole() !== "FIELD_LEAD" || !t.job.clientName) return t;
  return { ...t, job: { ...t.job, clientName: t.job.clientName.split(" ")[0]! } };
}

/** One time item, refused as the server would: another group's is 404, one's own 403. */
function reachableTime(id: string): number {
  const i = timeItems.findIndex((x) => x.id === id);
  const t = timeItems[i];
  if (!t) throw notFound("This time entry");
  if (isMe(t.cleaner.id)) throw selfApproval();
  if (!timeInReach(t)) throw notFound("This time entry");
  return i;
}

const withdrawals: ManagedWithdrawal[] = [
  {
    id: "w-1",
    employee: { id: "preview-cleaner", name: "Amara Diallo" },
    amountCents: 18240,
    status: "PENDING",
    paymentMethod: null,
    note: "For rent this week, thank you!",
    requestedAt: at(-60 * 3, 1),
    processedAt: null,
  },
  {
    id: "w-2",
    employee: { id: "u-jean", name: "Jean Morin" },
    amountCents: 9500,
    status: "APPROVED",
    paymentMethod: "E_TRANSFER",
    note: null,
    requestedAt: at(-60 * 20, 1),
    processedAt: null,
  },
  {
    id: "w-3",
    employee: { id: "u-lucie", name: "Lucie Paquette" },
    amountCents: 24700,
    status: "COMPLETED",
    paymentMethod: "E_TRANSFER",
    note: null,
    requestedAt: at(-60 * 50, 1),
    processedAt: at(-60 * 46, 1),
  },
];

const kitRequests: KitRequestItem[] = [
  {
    id: "k-1",
    employee: { id: "u-jean", name: "Jean Morin" },
    product: { id: "p-spray", name: "All-purpose spray", unit: "bottles", inWarehouse: 12 },
    kit: null,
    quantity: 3,
    reason: "Ran out on Rachel Est.",
    status: "PENDING",
    requestedAt: at(-60 * 5, 1),
  },
  {
    id: "k-2",
    employee: { id: "u-kofi", name: "Kofi Mensah" },
    product: { id: "p-cloth", name: "Microfibre cloths", unit: "cloths", inWarehouse: 8 },
    kit: null,
    quantity: 20,
    reason: null,
    status: "PENDING",
    requestedAt: at(-60 * 9, 1),
  },
  {
    id: "k-3",
    employee: { id: "u-priya", name: "Priya Nair" },
    product: null,
    kit: { id: "kit-deep", name: "Deep clean kit" },
    quantity: 1,
    reason: "Starting deep cleans next week.",
    status: "PENDING",
    requestedAt: at(-60 * 26, 1),
  },
];

// ---- Alerts ---------------------------------------------------------------------------

const alerts: Alert[] = [
  { id: "a-1", kind: "ISSUE_REPORTED", severity: "ERROR", title: "Urgent: Jean Morin is locked out", body: "Marc-André Roy · job #1432", createdAt: at(-6, 1), read: false, jobId: "m-102" },
  { id: "a-2", kind: "COVER_NEEDED", severity: "ERROR", title: "Cover needed — Samuel Tremblay in 3h", body: "Samuel Tremblay · job #1434", createdAt: at(-40, 1), read: false, jobId: "m-104" },
  { id: "a-3", kind: "TIME_CHANGE_REQUESTED", severity: "WARN", title: "Lucie Paquette asked to correct their hours", body: "Job #1419 — Olivia Chen. Finish 16:10 → 17:05.", createdAt: at(-60 * 20, 1), read: false, jobId: null },
  { id: "a-4", kind: "CLOCKED_IN", severity: "INFO", title: "Sofia Martins clocked in", body: "Claire Fontaine · job #1431", createdAt: at(-122, 1), read: true, jobId: "m-101" },
  { id: "a-5", kind: "CLOCK_LEFT_RUNNING", severity: "WARN", title: "Thomas Nguyen's clock is still running", body: "Nora Blake · job #1410 · open 11 h", createdAt: at(-60 * 30, 1), read: true, jobId: null },
];

const lateArrivals: LateArrival[] = [
  {
    id: "l-1",
    job: { id: "m-106", jobNumber: 1436, startsAt: at(-75), area: "Ville-Marie" },
    cleaner: { id: "u-elise", name: "Élise Gagnon" },
    clockedInAt: at(-58),
    minutesLate: 17,
    ratingPenalty: 0.5,
    strike: false,
  },
  {
    id: "l-2",
    job: { id: "m-prev-2", jobNumber: 1421, startsAt: at(-60 * 28), area: "Le Plateau" },
    cleaner: { id: "preview-cleaner", name: "Amara Diallo" },
    clockedInAt: at(-60 * 28 + 22),
    minutesLate: 22,
    ratingPenalty: 0.5,
    strike: false,
  },
  {
    id: "l-3",
    job: { id: "m-prev-3", jobNumber: 1410, startsAt: at(-60 * 74), area: "Verdun" },
    cleaner: { id: "u-thomas", name: "Thomas Nguyen" },
    clockedInAt: at(-60 * 74 + 48),
    minutesLate: 48,
    ratingPenalty: 1,
    strike: true,
  },
];

// ---- The office inbox ---------------------------------------------------------------

type InboxRow = OfficeMessage & { cleanerId: string; readByOffice: boolean };
const inbox: InboxRow[] = [];
function say(cleanerId: string, minutesAgo: number, body: string, fromOffice: boolean, readByOffice = true) {
  const cleaner = person(cleanerId)!;
  inbox.push({
    id: `c-${cleanerId}-${minutesAgo}`,
    clientEventId: null,
    fromMe: fromOffice,
    senderRole: fromOffice ? "ADMIN" : "EMPLOYEE",
    senderName: fromOffice ? "Marie D." : cleaner.name,
    body,
    attachment: null,
    createdAt: at(-minutesAgo, 1),
    receipt: "READ",
    cleanerId,
    readByOffice,
  });
}
say("preview-cleaner", 95, "Morning Amara. Claire at Saint-Denis asked if you can start 15 minutes early today.", true);
say("preview-cleaner", 92, "That works. I can be there for 8:45.", false);
say("preview-cleaner", 4, "Sofia and I will be done by 1, the oven took longer.", false, false);
say("u-lucie", 60 * 21, "Can I swap Thursday's 9am with someone? I have a dentist appointment.", false, false);
say("u-lucie", 60 * 20, "Also sent a time correction for yesterday.", false, false);
say("u-jean", 60 * 30, "Thanks for the new spray bottles.", false);
say("u-jean", 60 * 29, "Any time Jean.", true);

const INBOX_PEOPLE = ["preview-cleaner", "u-jean", "u-lucie", "u-kofi", "u-sofia"];
const online = new Set(["preview-cleaner", "u-sofia"]);

function conversation(cleanerId: string): OfficeConversation {
  const rows = inbox.filter((m) => m.cleanerId === cleanerId);
  const last = rows[rows.length - 1];
  return {
    cleaner: { id: cleanerId, name: person(cleanerId)!.name },
    online: online.has(cleanerId),
    last: last ? { body: last.body.slice(0, 140), at: last.createdAt, fromOffice: last.fromMe } : null,
    unreadCount: rows.filter((m) => !m.fromMe && !m.readByOffice).length,
  };
}
const unreadTotal = () => inbox.filter((m) => !m.fromMe && !m.readByOffice).length;
const strip = ({ cleanerId: _c, readByOffice: _r, ...m }: InboxRow): OfficeMessage => m;

// ---- The source -----------------------------------------------------------------------

export const previewManagerApi = {
  teamDay: async (date) => {
    await delay(null);
    guard("TEAM_VIEW");
    const key = date ?? dateKeyOf(new Date());
    const jobs = jobsOn(key)
      .filter((j) => j.status !== "CANCELLED")
      .filter(inScope)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map(toTeamJob);
    const best = new Map<string, { id: string; name: string; state: CrewState; jobId: string }>();
    for (const j of jobs) {
      for (const c of j.crew) {
        const state = c.state as CrewState;
        const prev = best.get(c.id);
        if (!prev || PRESSING.indexOf(state) < PRESSING.indexOf(prev.state)) best.set(c.id, { id: c.id, name: c.name, state, jobId: j.id });
      }
    }
    return {
      date: key,
      scope: teamScopeFor(previewRole()) ?? "GROUP",
      jobs,
      people: [...best.values()].sort((a, b) => a.name.localeCompare(b.name)),
    };
  },

  managerJob: async (jobId) => {
    await delay(null);
    guard("TEAM_VIEW");
    return jobDetail(scopedJob(jobId));
  },

  crewCandidates: async (jobId) => {
    await delay(null);
    guard("CREW_SET", "CREW_ADD");
    const job = scopedJob(jobId);
    const onJob = new Set(job.crew.map((c) => c.id));
    const rank = (c: Candidate) => (c.onJob ? 0 : c.availability === "AVAILABLE" && c.warnings.length === 0 ? 1 : c.availability === "NO_DATA" ? 2 : 3);
    const candidates = PEOPLE.map(
      (p): Candidate => ({
        id: p.id,
        name: p.name,
        tier: p.tier,
        onJob: onJob.has(p.id),
        availability: p.availability,
        dayOff: !!p.dayOff,
        warnings: warningsFor(p),
      }),
    ).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return { jobId, candidates };
  },

  setCrew: (jobId, body) =>
    once(body.clientEventId, () => {
      guard("CREW_SET");
      const job = scopedJob(jobId);
      const ids = [...new Set(body.cleanerIds)];
      if (ids.some((id) => !person(id))) throw new ApiError("One of those people can't be assigned.", 400, "VALIDATION", false);
      const current = job.crew.map((c) => c.id).sort().join();
      if ([...body.expectedCrewIds].sort().join() !== current) {
        throw refuse("CREW_CHANGED", "Someone changed this crew while you were choosing. Look again, then save.");
      }
      const tiers = ids.map((id) => person(id)!.tier);
      if (tiers.includes("TRAINEE") && tiers.every((t) => t === "TRAINEE")) {
        throw refuse("TRAINEE_UNPAIRED", "A Trainee must be paired with a Field Lead or an approved cleaner. Add one, or change the trainee's assignment.");
      }
      const overridden = warningsForAdding(job, ids);
      if (overridden.length && !body.acknowledgedWarnings) {
        throw refuse("WARNINGS_NOT_ACKNOWLEDGED", "Check the warnings for this crew, then save again.");
      }
      job.crew = ids.map((id) => job.crew.find((c) => c.id === id) ?? waiting(id));
      if (!job.leadId || !ids.includes(job.leadId)) job.leadId = ids[0] ?? null;
      return { job: jobDetail(job), overridden };
    }),

  addCleaner: (jobId, body) =>
    once(body.clientEventId, () => {
      guard("CREW_ADD");
      const job = scopedJob(jobId);
      const p = person(body.cleanerId);
      if (!p) throw notFound("That person");
      if (p.tier === "TRAINEE") {
        throw refuse("TRAINEE_NEEDS_CREW", "Trainees must be paired with a Field Lead, so an admin adds them with the rest of the crew.");
      }
      const overridden = warningsForAdding(job, [p.id]);
      if (overridden.length && !body.acknowledgedWarnings) {
        throw refuse("WARNINGS_NOT_ACKNOWLEDGED", "Check the warnings for this cleaner, then add them again.");
      }
      if (!job.crew.some((c) => c.id === p.id)) job.crew.push(waiting(p.id));
      if (!job.leadId) job.leadId = p.id;
      return { job: jobDetail(job), overridden };
    }),

  approvalsSummary: async () => {
    await delay(null, 250);
    guard("TIME_APPROVE", "WITHDRAWALS", "KIT_REQUESTS");
    const role = previewRole();
    return {
      time: can(role, "TIME_APPROVE") ? timeItems.filter((t) => t.status === "PENDING" && timeInReach(t)).length : null,
      withdrawals: can(role, "WITHDRAWALS")
        ? withdrawals.filter((w) => (w.status === "PENDING" || w.status === "APPROVED") && !isMe(w.employee.id)).length
        : null,
      kit: can(role, "KIT_REQUESTS") ? kitRequests.filter((k) => k.status === "PENDING" && !isMe(k.employee.id)).length : null,
    };
  },

  timeItems: async (status, cursor) => {
    await delay(null);
    guard("TIME_APPROVE");
    const reach = timeItems.filter(timeInReach);
    const list =
      status === "pending"
        ? reach.filter((t) => t.status === "PENDING").sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        : reach.filter((t) => t.status !== "PENDING").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return pageOf(list.map(asSeen), cursor);
  },

  timeItem: async (id) => {
    await delay(null);
    guard("TIME_APPROVE");
    return asSeen(timeItems[reachableTime(id)]!);
  },

  decideTime: (id, body) =>
    once(body.clientEventId, () => {
      guard("TIME_APPROVE");
      const i = reachableTime(id);
      const t = timeItems[i]!;
      if (body.decision === "ADJUST" && !can(previewRole(), "TIME_ADJUST")) throw forbidden();
      if (t.status !== "PENDING") throw refuse("ALREADY_DECIDED", `This request was already ${t.status.toLowerCase()}.`);
      const note = body.note?.trim() || null;
      if (body.decision !== "APPROVE" && !note) throw new ApiError("Add a note for the cleaner.", 400, "NOTE_REQUIRED", false);
      let current = t.current;
      if (body.decision === "APPROVE") current = { start: t.requested.start ?? t.current.start, end: t.requested.end ?? t.current.end };
      if (body.decision === "ADJUST") {
        if (!body.start) throw new ApiError("Choose the start time.", 400, "VALIDATION", false);
        if (t.current.end && !body.end) throw new ApiError("Choose the finish time.", 400, "VALIDATION", false);
        if (body.end && body.end <= body.start) throw new ApiError("The finish has to be after the start.", 400, "VALIDATION", false);
        current = { start: body.start, end: body.end ?? null };
      }
      const decided: TimeItem = {
        ...t,
        current,
        status: body.decision === "REJECT" ? "REJECTED" : "APPROVED",
        decided: { by: previewPerson().name, at: new Date().toISOString(), note },
      };
      timeItems[i] = decided;
      return asSeen(decided);
    }),

  withdrawalsQueue: async (status, cursor) => {
    await delay(null);
    guard("WITHDRAWALS");
    const others = withdrawals.filter((w) => !isMe(w.employee.id));
    const open = others.filter((w) => w.status === "PENDING" || w.status === "APPROVED");
    const list =
      status === "open"
        ? open.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
        : others.filter((w) => !open.includes(w)).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    return { ...pageOf(list, cursor), openTotalCents: open.reduce((s, w) => s + w.amountCents, 0) };
  },

  withdrawal: async (id) => {
    await delay(null);
    guard("WITHDRAWALS");
    const w = withdrawals.find((x) => x.id === id);
    if (!w) throw notFound("This withdrawal");
    if (isMe(w.employee.id)) throw selfApproval();
    return w;
  },

  decideWithdrawal: (id, body) =>
    once(body.clientEventId, () => {
      guard("WITHDRAWALS");
      const i = withdrawals.findIndex((w) => w.id === id);
      const w = withdrawals[i];
      if (!w) throw notFound("This withdrawal");
      if (isMe(w.employee.id)) throw selfApproval();
      const ok =
        (body.action === "APPROVE" && w.status === "PENDING") ||
        (body.action !== "APPROVE" && (w.status === "PENDING" || w.status === "APPROVED"));
      if (!ok) {
        throw refuse(
          "WITHDRAWAL_STATE",
          body.action === "APPROVE" ? "Only pending withdrawals can be approved" : "This withdrawal cannot be changed now",
        );
      }
      if (body.action !== "REJECT" && !body.paymentMethod) throw new ApiError("Choose how it's being paid.", 400, "VALIDATION", false);
      const next: ManagedWithdrawal = {
        ...w,
        status: body.action === "APPROVE" ? "APPROVED" : body.action === "COMPLETE" ? "COMPLETED" : "REJECTED",
        paymentMethod: body.action === "REJECT" ? w.paymentMethod : body.paymentMethod,
        processedAt: body.action === "APPROVE" ? w.processedAt : new Date().toISOString(),
      };
      withdrawals[i] = next;
      return next;
    }),

  kitRequests: async (cursor) => {
    await delay(null);
    guard("KIT_REQUESTS");
    return pageOf(kitRequests.filter((k) => k.status === "PENDING" && !isMe(k.employee.id)), cursor);
  },

  decideKitRequest: (id, body) =>
    once(body.clientEventId, () => {
      guard("KIT_REQUESTS");
      const i = kitRequests.findIndex((k) => k.id === id);
      const k = kitRequests[i];
      if (!k) throw notFound("This request");
      if (isMe(k.employee.id)) throw selfApproval();
      if (k.status !== "PENDING") throw refuse("ALREADY_RESOLVED", "Request has already been resolved");
      if (body.decision === "APPROVE" && k.product && k.product.inWarehouse < k.quantity) {
        throw refuse(
          "WAREHOUSE_SHORT",
          `Only ${k.product.inWarehouse} ${k.product.unit} of ${k.product.name} in the warehouse — this request needs ${k.quantity}.`,
        );
      }
      const next: KitRequestItem = {
        ...k,
        status: body.decision === "REJECT" ? "REJECTED" : k.product ? "FULFILLED" : "APPROVED",
        product: k.product && body.decision === "APPROVE" ? { ...k.product, inWarehouse: k.product.inWarehouse - k.quantity } : k.product,
      };
      kitRequests[i] = next;
      return next;
    }),

  alerts: async (cursor) => {
    await delay(null);
    guard("ALERTS");
    const visible = alerts.map((a) => ({ ...a, jobId: a.jobId && findJob(a.jobId) && inScope(findJob(a.jobId)!) ? a.jobId : null }));
    return { ...pageOf(visible, cursor), unreadCount: alerts.filter((a) => !a.read).length };
  },

  markAlertsRead: async ({ ids }) => {
    await delay(null, 150);
    guard("ALERTS");
    for (const a of alerts) if (ids.includes(a.id)) a.read = true;
    return { unreadCount: alerts.filter((a) => !a.read).length };
  },

  lateArrivals: async (cursor) => {
    await delay(null);
    guard("ALERTS");
    const scoped = teamScopeFor(previewRole()) === "GROUP" ? lateArrivals.filter((l) => GROUP.has(l.cleaner.id)) : lateArrivals;
    return pageOf(scoped, cursor);
  },

  issues: async (status, cursor) => {
    await delay(null);
    guard("ISSUES");
    const open = issues.filter((i) => i.status !== "RESOLVED");
    const list =
      status === "open"
        ? [...open].sort((a, b) => (a.urgency === "URGENT" ? 0 : 1) - (b.urgency === "URGENT" ? 0 : 1) || b.reportedAt.localeCompare(a.reportedAt))
        : issues.filter((i) => i.status === "RESOLVED").sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
    return { ...pageOf(list, cursor), openCount: open.length };
  },

  issue: async (id) => {
    await delay(null);
    guard("ISSUES");
    const found = issues.find((i) => i.id === id);
    if (!found) throw notFound("This problem report");
    return found;
  },

  setIssueStatus: (id, body) =>
    once(body.clientEventId, () => {
      guard("ISSUES");
      const i = issues.findIndex((x) => x.id === id);
      const found = issues[i];
      if (!found) throw notFound("This problem report");
      const note = body.resolutionNote?.trim() || null;
      if (body.status === "RESOLVED" && !note) throw new ApiError("Say what was done, for the cleaner.", 400, "NOTE_REQUIRED", false);
      const now = new Date().toISOString();
      const next: ManagedIssue = {
        ...found,
        status: body.status,
        acknowledgedAt: body.status === "OPEN" ? null : (found.acknowledgedAt ?? now),
        resolvedAt: body.status === "RESOLVED" ? now : null,
        resolvedBy: body.status === "RESOLVED" ? previewPerson().name : null,
        resolutionNote: body.status === "RESOLVED" ? note : null,
      };
      issues[i] = next;
      return next;
    }),

  officeConversations: async (cursor) => {
    await delay(null);
    guard("OFFICE_INBOX");
    const list = INBOX_PEOPLE.map(conversation).sort(
      (a, b) =>
        b.unreadCount - a.unreadCount ||
        (b.last?.at ?? "").localeCompare(a.last?.at ?? "") ||
        a.cleaner.name.localeCompare(b.cleaner.name),
    );
    return { ...pageOf(list, cursor), unreadTotal: unreadTotal() };
  },

  officeConversation: async (cleanerId) => {
    await delay(null, 200);
    guard("OFFICE_INBOX");
    if (!INBOX_PEOPLE.includes(cleanerId)) throw notFound("This conversation");
    return conversation(cleanerId);
  },

  conversationMessages: async (cleanerId, cursor) => {
    await delay(null);
    guard("OFFICE_INBOX");
    if (!INBOX_PEOPLE.includes(cleanerId)) throw notFound("This conversation");
    return pageOf(inbox.filter((m) => m.cleanerId === cleanerId).reverse().map(strip), cursor);
  },

  replyAsOffice: async (cleanerId, req) => {
    await delay(null, 500);
    guard("OFFICE_INBOX");
    if (!INBOX_PEOPLE.includes(cleanerId)) throw notFound("This conversation");
    const existing = inbox.find((m) => m.clientEventId === req.clientEventId);
    if (existing) return strip(existing);
    const row: InboxRow = {
      id: `c-${req.clientEventId}`,
      clientEventId: req.clientEventId,
      fromMe: true,
      senderRole: "ADMIN",
      senderName: previewPerson().name,
      body: req.body.trim(),
      attachment: null,
      createdAt: new Date().toISOString(),
      receipt: online.has(cleanerId) ? "DELIVERED" : "SENT",
      cleanerId,
      readByOffice: true,
    };
    inbox.push(row);
    return strip(row);
  },

  markConversationRead: async (cleanerId) => {
    await delay(null, 150);
    guard("OFFICE_INBOX");
    for (const m of inbox) if (m.cleanerId === cleanerId) m.readByOffice = true;
    return { unreadTotal: unreadTotal() };
  },
} satisfies Pick<
  DataSource,
  | "teamDay"
  | "managerJob"
  | "crewCandidates"
  | "setCrew"
  | "addCleaner"
  | "approvalsSummary"
  | "timeItems"
  | "timeItem"
  | "decideTime"
  | "withdrawalsQueue"
  | "withdrawal"
  | "decideWithdrawal"
  | "kitRequests"
  | "decideKitRequest"
  | "alerts"
  | "markAlertsRead"
  | "lateArrivals"
  | "issues"
  | "issue"
  | "setIssueStatus"
  | "officeConversations"
  | "officeConversation"
  | "conversationMessages"
  | "replyAsOffice"
  | "markConversationRead"
>;
