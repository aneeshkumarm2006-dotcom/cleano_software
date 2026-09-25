/**
 * Clocks nobody stopped.
 *
 * Nothing in this app has ever closed a work session: `endedAt` is written by
 * an explicit clock-out and by nothing else. Eighteen sessions were open in
 * production when this shipped, the oldest for thirty-four days. Because
 * `sessionMinutes` measures an open session to NOW, that one was reporting
 * roughly eight hundred hours, and those hours reach payroll.
 *
 * These tests pin the rule, and pin the two things that would quietly make it
 * useless: flagging honest long shifts (which trains an admin to ignore the
 * queue) and suggesting an end time that is wrong in a way nobody can see.
 */
import {
  ABANDONED_SESSION_HOURS,
  ASSUMED_SHIFT_HOURS,
  STALE_SESSION_HOURS,
  describeOpenFor,
  isStale,
  openHours,
  overstatedHours,
  severityOf,
  suggestedEnd,
} from "../src/lib/stale-clock";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) passed++;
  else failures.push(name);
};

const NOW = new Date("2026-09-23T18:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

// --- the threshold ------------------------------------------------------
check("a 2-hour session is not stale", !isStale({ startedAt: hoursAgo(2) }, NOW));
check("an 8-hour shift is not stale", !isStale({ startedAt: hoursAgo(8) }, NOW));
check(
  "a 12-hour double shift is not stale",
  !isStale({ startedAt: hoursAgo(12) }, NOW),
);
check(
  "a job running past midnight is not stale",
  !isStale({ startedAt: hoursAgo(15.9) }, NOW),
);
check(
  `${STALE_SESSION_HOURS} hours is the line`,
  isStale({ startedAt: hoursAgo(STALE_SESSION_HOURS) }, NOW),
);
check("a 34-day session is stale", isStale({ startedAt: hoursAgo(816) }, NOW));

// A CLOSED session is never stale, however long it ran. That one was answered.
check(
  "a closed 40-hour session is not stale",
  !isStale({ startedAt: hoursAgo(40), endedAt: hoursAgo(1) }, NOW),
);

// --- severity -----------------------------------------------------------
check(
  "17 hours reads as forgotten",
  severityOf({ startedAt: hoursAgo(17) }, NOW) === "forgotten",
);
check(
  `${ABANDONED_SESSION_HOURS} hours reads as abandoned`,
  severityOf({ startedAt: hoursAgo(ABANDONED_SESSION_HOURS) }, NOW) === "abandoned",
);

// --- the suggested end --------------------------------------------------
// The job's own finish is the strongest signal and must win.
{
  const jobEnd = hoursAgo(30);
  const got = suggestedEnd(
    { startedAt: hoursAgo(34), jobStartTime: hoursAgo(34), jobEndTime: jobEnd },
    NOW,
  );
  check("the job's scheduled finish is preferred", got?.getTime() === jobEnd.getTime());
}
// Failing that, the job's start plus a normal shift.
{
  const jobStart = hoursAgo(34);
  const got = suggestedEnd({ startedAt: hoursAgo(34), jobStartTime: jobStart }, NOW);
  const want = new Date(jobStart.getTime() + ASSUMED_SHIFT_HOURS * 3600_000);
  check("falls back to the job start plus a shift", got?.getTime() === want.getTime());
}
// Failing both, the session's own start plus a shift. NEVER `now` — that is
// the very inflation this exists to catch.
{
  const start = hoursAgo(50);
  const got = suggestedEnd({ startedAt: start }, NOW);
  check(
    "falls back to the clock-in plus a shift",
    got?.getTime() === start.getTime() + ASSUMED_SHIFT_HOURS * 3600_000,
  );
  check("the guess is never now", got?.getTime() !== NOW.getTime());
}
// A job end BEFORE the clock-in is not an answer; skip to the next candidate.
{
  const start = hoursAgo(20);
  const got = suggestedEnd(
    { startedAt: start, jobEndTime: hoursAgo(40), jobStartTime: hoursAgo(40) },
    NOW,
  );
  check("a finish before the start is rejected", !!got && got.getTime() > start.getTime());
}
// A guess in the future is not a guess about the past.
{
  const start = hoursAgo(20);
  const got = suggestedEnd({ startedAt: start, jobEndTime: new Date(NOW.getTime() + 3600_000) }, NOW);
  check("a future finish is rejected", !!got && got.getTime() <= NOW.getTime());
}
// When nothing can be guessed honestly, say so rather than inventing one.
check(
  "an unusable start yields no guess",
  suggestedEnd({ startedAt: "not a date" }, NOW) === null,
);

// --- what it costs ------------------------------------------------------
{
  const start = hoursAgo(816);
  check("a 34-day clock reports ~816 open hours", Math.round(openHours({ startedAt: start }, NOW)) === 816);
  const over = overstatedHours({ startedAt: start }, NOW);
  check(
    "the overstatement is the open time minus a real shift",
    Math.round(over) === 816 - ASSUMED_SHIFT_HOURS,
  );
}

// --- how it reads -------------------------------------------------------
check("under 48h reads in hours", describeOpenFor({ startedAt: hoursAgo(20) }, NOW) === "20 hours");
check("one hour is singular", describeOpenFor({ startedAt: hoursAgo(1) }, NOW) === "1 hour");
check("over 48h reads in days", describeOpenFor({ startedAt: hoursAgo(816) }, NOW) === "34 days");

if (failures.length) {
  console.error(`✘ ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✔ ${passed} passed, 0 failed`);
