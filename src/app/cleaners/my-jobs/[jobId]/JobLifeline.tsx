"use client";

import { useEffect } from "react";

/**
 * The "where am I going, who do I call" strip for a job, written to
 * localStorage every time the job page renders successfully.
 *
 * Why this exists: error.tsx in this folder is a CLIENT boundary, and the thing
 * that most often throws this page is the database being unreachable — the
 * P1001 / P1017 storm in the dev log took out `getCurrentOrg()` and with it
 * every route at once, this page included. So the boundary cannot go and look
 * the job up; whatever it shows has to have been written down while the page
 * still worked.
 *
 * A cleaner standing on a doorstep with a broken page needs two things: the
 * address they are going to, and the office's number. That is exactly what this
 * stores, and the boundary reads it back.
 *
 * DELIBERATELY NOT STORED: access notes (door, gate and buzzer codes), the
 * customer's phone, their name. localStorage outlives the session — a cleaner
 * who signs out, or loses the phone, would leave those behind on the device.
 * The page's address `include` is fail-closed about exactly that data (see the
 * note on `clientAddress` in page.tsx), and a cache is not the place to undo it.
 * A boundary that shows the street but not the door code is still useful; one
 * that leaks door codes is not worth having.
 */

/** One shared key holding a jobId -> entry map, so pruning is one read/write. */
const STORE_KEY = "cleano_job_lifeline";
/**
 * The office number, kept OUTSIDE the per-job map on purpose. It is the same
 * number for every job, so one successfully-opened job anywhere in the app is
 * enough to give the boundary a phone to offer on a job this cleaner has never
 * managed to open — which is precisely the case where they most need one.
 */
const PHONE_KEY = "cleano_office_phone";
/** A cleaner works a handful of jobs, not a history. Bound both dimensions. */
const MAX_ENTRIES = 10;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type JobLifeline = {
  /** Street + city/postal, already formatted — the boundary does no address logic. */
  address: string | null;
  /** "Apt 23" and the like, on its own line for the same reason the hero gives it one. */
  aptLabel: string | null;
  /** "Thu, Sep 11 · 9:00 AM" — enough to confirm this is the right job. */
  when: string | null;
  /** general.businessPhone. Rendered as a tel: link. */
  officePhone: string | null;
  savedAt: number;
};

type Store = Record<string, JobLifeline>;

function readStore(): Store {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // Anything that is not the shape we wrote is treated as absent rather than
    // trusted: this is read on an error screen, which is the worst possible
    // place to throw a second time.
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    // Private mode, a full quota, a half-written value — all mean "no cache".
    return {};
  }
}

/** The last-known-good strip for a job, or null if we never stored one. */
export function readJobLifeline(jobId: string): JobLifeline | null {
  const entry = readStore()[jobId];
  if (!entry) return null;
  if (Date.now() - entry.savedAt > MAX_AGE_MS) return null;
  return entry;
}

/** The office number from ANY job this cleaner has opened. */
export function readOfficePhone(): string | null {
  try {
    return window.localStorage.getItem(PHONE_KEY) || null;
  } catch {
    return null;
  }
}

export default function JobLifeline({
  jobId,
  address,
  aptLabel,
  when,
  officePhone,
}: { jobId: string } & Omit<JobLifeline, "savedAt">) {
  useEffect(() => {
    try {
      const store = readStore();
      store[jobId] = { address, aptLabel, when, officePhone, savedAt: Date.now() };

      // Prune on write, not on read: the read happens on an error screen where
      // doing less is the point.
      const kept = Object.entries(store)
        .filter(([, e]) => Date.now() - (e?.savedAt ?? 0) <= MAX_AGE_MS)
        .sort((a, b) => b[1].savedAt - a[1].savedAt)
        .slice(0, MAX_ENTRIES);

      window.localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(kept)));
      if (officePhone) window.localStorage.setItem(PHONE_KEY, officePhone);
    } catch {
      // Storage unavailable or full. The boundary degrades to "call the office
      // from My jobs" — never worth breaking a working page over.
    }
  }, [jobId, address, aptLabel, when, officePhone]);

  return null;
}
