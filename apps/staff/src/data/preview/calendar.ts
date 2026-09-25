// Sample calendar for development builds: the Jobs tab's sample jobs, plus a
// believable spread of work on the other weekdays, for any span asked for.
import type { JobSummary } from "@bookmops/api/v1";
import { addDays, daysBetween, weekdayIndex } from "@bookmops/ui-native";

import type { DataSource } from "../source";
import { delay } from "./delay";
import { at } from "./zone";
import { previewMe, previewPast, previewUpcoming } from "./jobs";

const TZ = previewMe.company.timezone;
const keyOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));


const PLACES = [
  { line1: "4218 rue Saint-Denis", line2: "Apt 3", area: "Le Plateau", pay: 9600, h: 9, m: 0, len: 3 },
  { line1: "1250 boul. René-Lévesque", line2: null, area: "Ville-Marie", pay: 6400, h: 13, m: 30, len: 2 },
  { line1: "77 av. Duluth Est", line2: "Unit 2", area: "Le Plateau", pay: 4800, h: 16, m: 15, len: 1.5 },
  { line1: "5 rue Sherbrooke Ouest", line2: null, area: "Westmount", pay: 12000, h: 10, m: 0, len: 3 },
  { line1: "6700 av. Christophe-Colomb", line2: "2e étage", area: "Villeray", pay: 7200, h: 8, m: 30, len: 2.5 },
];
/** Which of PLACES each weekday gets, Monday first: a steady, varied week. */
const PATTERN = [[0, 1], [4], [0, 1, 2], [3], [1, 2], [], []];

function generated(key: string): JobSummary[] {
  return (PATTERN[weekdayIndex(key)] ?? []).map((i) => {
    const place = PLACES[i]!;
    const startsAt = at(key, place.h, place.m);
    return {
      id: `cal-${key}-${i}`,
      startsAt,
      endsAt: new Date(new Date(startsAt).getTime() + place.len * 3_600_000).toISOString(),
      address: { line1: place.line1, line2: place.line2, area: place.area },
      service: { category: "RESIDENTIAL", label: "Standard clean" },
      payCents: place.pay,
      status: key < keyOf(new Date().toISOString()) ? "COMPLETED" : "SCHEDULED",
      clock: { state: "NOT_STARTED", clockedInAt: null },
    };
  });
}

export const previewCalendarApi = {
  jobsBetween: (from, to) => {
    const real = [...previewPast, ...previewUpcoming];
    const realDays = new Set(real.map((j) => keyOf(j.startsAt)));
    const items: JobSummary[] = real.filter((j) => {
      const k = keyOf(j.startsAt);
      return k >= from && k <= to;
    });
    for (let i = 0; i <= daysBetween(from, to); i++) {
      const key = addDays(from, i);
      // Days that already have the Jobs tab's sample jobs keep just those.
      if (!realDays.has(key)) items.push(...generated(key));
    }
    items.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return delay({ items, nextCursor: null });
  },
} satisfies Pick<DataSource, "jobsBetween">;
