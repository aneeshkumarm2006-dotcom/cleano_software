// Sample available jobs for development builds, held in memory so a claim
// really takes the job off the board and puts it in My jobs. Never bundled
// into a release (see ./jobs.ts).
//
// One job always loses its race ("fully staffed") and one is outside the
// sample cleaner's service categories, so both refusal paths can be seen.
import { ApiError } from "@bookmops/api/client";
import type { AvailableJobDetailResponse, AvailableWhen, ClaimJobResponse, JobSummary } from "@bookmops/api/v1";

import type { DataSource } from "../source";
import { delay } from "./delay";
import { companyHour, daysFromToday } from "./zone";
import { previewUpcoming } from "./jobs";

const TZ = "America/Toronto";

/** A start `days` from today at `hour`:`minute`, company time (close enough for samples). */
function startAt(days: number, hour: number, minute = 0): Date {
  return daysFromToday(days, hour, minute);
}

type Seed = {
  id: string;
  days: number;
  hour: number;
  minute?: number;
  lengthH: number | null;
  area: string;
  street: string;
  category: string;
  label: string;
  type: string | null;
  beds: number | null;
  baths: number | null;
  pay: AvailableJobDetailResponse["pay"];
  required: number;
  claimed: number;
  notes?: string;
  addOns?: { name: string; quantity: number }[];
  /** How the sample server answers a claim. */
  refuse?: { code: string; message: string };
};

const SEEDS: Seed[] = [
  {
    id: "a1",
    days: 0,
    hour: Math.min(companyHour() + 3, 21),
    lengthH: 3,
    area: "Golden Square Mile",
    street: "910 rue Sherbrooke Ouest",
    category: "DEEP",
    label: "Deep clean",
    type: "Condo",
    beds: 3,
    baths: 2,
    pay: { type: "PERCENTAGE", estimateCents: 9600, hourlyRateCents: null },
    required: 2,
    claimed: 1,
    notes: "Inside the oven and fridge. Bring the extension pole for the high windows.",
    addOns: [
      { name: "Inside oven", quantity: 1 },
      { name: "Inside fridge", quantity: 1 },
    ],
  },
  {
    id: "a2",
    days: 1,
    hour: 10,
    lengthH: 2,
    area: "Le Plateau",
    street: "55 av. du Mont-Royal Est",
    category: "RESIDENTIAL",
    label: "Standard clean",
    type: "Apartment",
    beds: 1,
    baths: 1,
    pay: { type: "HOURLY", estimateCents: null, hourlyRateCents: 2400 },
    required: 1,
    claimed: 0,
  },
  {
    id: "a3",
    days: 1,
    hour: 14,
    minute: 30,
    lengthH: 2.5,
    area: "Rosemont",
    street: "3120 rue Masson",
    category: "RESIDENTIAL",
    label: "Standard clean",
    type: "House",
    beds: 2,
    baths: 1,
    pay: { type: "PERCENTAGE", estimateCents: 7800, hourlyRateCents: null },
    required: 2,
    claimed: 1,
    refuse: { code: "FULLY_STAFFED", message: "This job is already fully staffed" },
  },
  {
    id: "a4",
    days: 3,
    hour: 9,
    lengthH: 4,
    area: "Mile End",
    street: "7200 rue Hutchison",
    category: "MOVE_IN_OUT",
    label: "Move-out clean",
    type: "Apartment",
    beds: 2,
    baths: 1,
    pay: { type: "PERCENTAGE", estimateCents: 12800, hourlyRateCents: null },
    required: 2,
    claimed: 0,
    notes: "Empty unit. Walls wiped down, inside every cupboard.",
    addOns: [{ name: "Inside cabinets", quantity: 1 }],
  },
  {
    id: "a5",
    days: 5,
    hour: 8,
    lengthH: null,
    area: "Saint-Laurent",
    street: "1500 boul. Marcel-Laurin",
    category: "COMMERCIAL",
    label: "Office clean",
    type: null,
    beds: null,
    baths: 2,
    pay: { type: "FLAT", estimateCents: null, hourlyRateCents: null },
    required: 3,
    claimed: 1,
    refuse: { code: "CATEGORY_NOT_ALLOWED", message: "This job isn't in your approved service categories." },
  },
  {
    id: "a6",
    days: 9,
    hour: 13,
    lengthH: 3,
    area: "Verdun",
    street: "4410 rue Wellington",
    category: "DEEP",
    label: "Deep clean",
    type: "House",
    beds: 3,
    baths: 2,
    pay: { type: "PERCENTAGE", estimateCents: 10400, hourlyRateCents: null },
    required: 1,
    claimed: 0,
  },
];

function detail(s: Seed): AvailableJobDetailResponse {
  const start = startAt(s.days, s.hour, s.minute);
  const end = s.lengthH == null ? null : new Date(start.getTime() + s.lengthH * 3_600_000);
  return {
    id: s.id,
    startsAt: start.toISOString(),
    endsAt: end ? end.toISOString() : null,
    isFlexible: s.id === "a6",
    area: s.area,
    service: { category: s.category, label: s.label },
    property: { type: s.type, beds: s.beds, baths: s.baths, halfBaths: null, squareFeet: s.beds ? s.beds * 450 : null },
    pay: s.pay,
    crew: { required: s.required, claimed: s.claimed },
    plannedMinutes: s.lengthH == null ? null : Math.round(s.lengthH * 60),
    addOns: s.addOns ?? [],
    checklists: [{ name: `${s.label} checklist`, itemCount: 18, requiredCount: 6 }],
    notes: s.notes ?? null,
  };
}

const board = new Map(SEEDS.map((s) => [s.id, s]));
/** Replayed claims answer with what they answered the first time, as the server does. */
const claims = new Map<string, ClaimJobResponse>();

const weekday = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, weekday: "short" });
function matches(startsAt: string, when: AvailableWhen): boolean {
  if (when === "all") return true;
  const d = new Date(startsAt);
  if (when === "weekend") return ["Sat", "Sun"].includes(weekday.format(d).replace(".", ""));
  return d.getTime() - Date.now() < 7 * 86_400_000;
}

function notFound(): never {
  throw new ApiError("This job isn't available any more.", 404, "NOT_FOUND", false);
}

export const previewAvailableApi = {
  availableJobs: (when = "all") =>
    delay({
      items: [...board.values()].map(detail).filter((j) => matches(j.startsAt, when)),
      nextCursor: null,
    }),
  availableJob: async (id) => {
    const seed = board.get(id);
    return seed ? delay(detail(seed)) : delay(null, 250).then(notFound);
  },
  claimJob: async (id, clientEventId) => {
    await delay(null, 700);
    const replay = claims.get(clientEventId);
    if (replay) return replay;
    const seed = board.get(id);
    if (!seed) notFound();
    if (seed.refuse) {
      if (seed.refuse.code === "FULLY_STAFFED") board.delete(id);
      throw new ApiError(seed.refuse.message, 409, seed.refuse.code, false);
    }
    board.delete(id);
    const d = detail(seed);
    const job: JobSummary = {
      id,
      startsAt: d.startsAt,
      endsAt: d.endsAt,
      // The street arrives only now that the job is theirs.
      address: { line1: seed.street, line2: null, area: seed.area },
      service: d.service,
      payCents: d.pay.estimateCents,
      status: "SCHEDULED",
      clock: { state: "NOT_STARTED", clockedInAt: null },
    };
    // Into the sample My jobs, so the claim shows up there as it would for real.
    previewUpcoming.push(job);
    previewUpcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const res = { job };
    claims.set(clientEventId, res);
    return res;
  },
} satisfies Pick<DataSource, "availableJobs" | "availableJob" | "claimJob">;
