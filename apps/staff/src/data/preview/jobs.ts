// Sample data for the Me, Today and Jobs areas, in development builds only.
// Never bundled into a release: the only import is behind __DEV__
// (../session.tsx), and Metro strips dead branches from production bundles.
//
// Times are built relative to "now" so the Today screen always has a next job
// and a later one, whatever time the preview is opened.
import type { JobDetailResponse, JobSummary, MeResponse, TodayResponse } from "@bookmops/api/v1";

import type { DataSource } from "../source";
import { delay } from "./delay";
import { previewPerson, previewRole } from "./role";

const TZ = "America/Toronto";

function at(hoursFromNow: number, roundTo = 15): string {
  const d = new Date(Date.now() + hoursFromNow * 3_600_000);
  d.setUTCMinutes(Math.round(d.getUTCMinutes() / roundTo) * roundTo, 0, 0);
  return d.toISOString();
}

function job(id: string, startH: number, lengthH: number, over: Partial<JobSummary> = {}): JobSummary {
  return {
    id,
    startsAt: at(startH),
    endsAt: at(startH + lengthH),
    address: { line1: "4218 rue Saint-Denis", line2: "Apt 3", area: "Le Plateau" },
    service: { category: "DEEP", label: "Deep clean" },
    payCents: 9600,
    status: "SCHEDULED",
    clock: { state: "NOT_STARTED", clockedInAt: null },
    ...over,
  };
}

/** Whoever the preview is signed in as (./role.ts), in the sample company. */
export function previewMe(): MeResponse {
  return {
    person: { ...previewPerson(), role: previewRole() },
    company: { id: "preview-co", name: "Sample Cleaning Co.", slug: "sample", timezone: TZ, currency: "CAD" },
    mustChangePassword: false,
  };
}

const upcoming: JobSummary[] = [
  job("j1", 0.8, 3),
  job("j2", 4.5, 2, {
    address: { line1: "1250 boul. René-Lévesque", line2: null, area: "Ville-Marie" },
    service: { category: "RESIDENTIAL", label: "Standard clean" },
    payCents: 6400,
  }),
  job("j3", 7.2, 1.5, {
    address: { line1: "77 av. Duluth Est", line2: "Unit 2", area: "Le Plateau" },
    service: { category: "RESIDENTIAL", label: "Standard clean" },
    payCents: 4800,
  }),
  job("j4", 26, 3, {
    address: { line1: "5 rue Sherbrooke Ouest", line2: null, area: "Westmount" },
    service: { category: "MOVE_IN", label: "Move-in clean" },
    payCents: 12000,
  }),
];

export const previewToday: TodayResponse = {
  date: new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()),
  nextJob: upcoming[0],
  laterToday: upcoming.slice(1, 3),
  week: { hours: 22.5, jobs: 7, earningsCents: 41200 },
  unread: { office: 2, notifications: 1 },
};

export const previewUpcoming: JobSummary[] = upcoming;

export const previewPast: JobSummary[] = [
  job("p1", -26, 3, { status: "COMPLETED", clock: { state: "CLOCKED_OUT", clockedInAt: null } }),
  job("p2", -50, 2, {
    status: "PAID",
    clock: { state: "CLOCKED_OUT", clockedInAt: null },
    address: { line1: "300 rue Rachel Est", line2: null, area: "Le Plateau" },
    payCents: 6400,
  }),
];

export function previewJob(id: string): JobDetailResponse {
  const base = [...upcoming, ...previewPast].find((j) => j.id === id) ?? upcoming[0];
  return {
    ...base,
    client: { firstName: "Claire" },
    notes: "Buzzer 3 · key in the lockbox, code 1287. Two cats — keep the bedroom door closed.",
    checklist: { done: 0, total: 18 },
    crew: [
      { id: "preview-cleaner", name: "Amara Diallo", isLead: true },
      { id: "preview-2", name: "Sofia Martins", isLead: false },
    ],
    plannedMinutes: 180,
  };
}

export const previewJobsApi = {
  me: () => delay(previewMe()),
  changePassword: () => delay({ ok: true as const }),
  today: () => delay(previewToday),
  jobs: (scope) => delay({ items: scope === "past" ? previewPast : previewUpcoming, nextCursor: null }),
  job: (id) => delay(previewJob(id)),
} satisfies Pick<DataSource, "me" | "changePassword" | "today" | "jobs" | "job">;
