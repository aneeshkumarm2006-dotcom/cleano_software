"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import DatePicker from "@/components/ui/DatePicker";
import {
  INDUSTRIES,
  INDUSTRY_LABELS,
  INDUSTRY_UNSPECIFIED,
  isIndustryFilter,
  type IndustryFilter,
  type JobIndustry,
} from "@/lib/calendar-labels";
import { formatDate, storeCivilDayRange } from "@/lib/timezone";

/**
 * How long the bar says "updating" before it stops assuming the navigation is
 * merely slow and starts saying it may have failed.
 *
 * This is NOT a deadline after which the notice disappears. The 20s version was:
 * QA measured `aria-busy` clearing at exactly 20.0s in 4/4 trials while the
 * navigation was still in flight (or dead), leaving the OLD industry's figures
 * on screen, the OLD chip pressed, and nothing at all telling the admin their
 * change had been lost. A busy marker that lies is worse than one that
 * overstays.
 *
 * Now the only thing that ends the notice is the router committing the query
 * string that was asked for. Hitting this ceiling only changes what the notice
 * SAYS. It is set well above a healthy render of this page (~15-20s of real
 * server work: ~18 queries against a remote pooler) so that a genuinely slow —
 * but succeeding — navigation is never accused of having failed.
 */
const BUSY_NOTICE_MS = 45_000;

export interface AnalyticsFilters {
  industry: IndustryFilter;
  /** Civil dates ("2026-08-01") in the store timezone, or null. */
  from: string | null;
  to: string | null;
  isFiltered: boolean;
  hasDateRange: boolean;
}

/**
 * The page-level filter. Analytics had no filter mechanism at all before this
 * (Q7 §1) — the page took no searchParams and handed the view 19 finished
 * props. State lives in the URL so it survives a refresh and can be shared,
 * and so the server does the recomputation over the same job rows it already
 * fetched.
 *
 * Rendered only on the tabs whose numbers are job-derived (see ./tabs.ts).
 */
export default function AnalyticsFilterBar({
  filters,
  industryCounts,
  showUnspecified,
  scopedJobCount,
  unfilteredJobCount,
  activeTab,
}: {
  filters: AnalyticsFilters;
  industryCounts: Partial<Record<JobIndustry, number>>;
  showUnspecified: boolean;
  /** Jobs inside the date range, all industries — the ALL chip's count. */
  scopedJobCount: number;
  unfilteredJobCount: number;
  activeTab: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentQs = searchParams.toString();

  // The query string the most recent click asked for, or null when the URL on
  // screen is already the one that was asked for.
  //
  // This used to be `useTransition`'s `isPending`, with every control
  // `disabled={pending}` and `.an-filterbar[data-pending="1"]` adding
  // `pointer-events: none`. That combination is a trap: the transition stays
  // pending for as long as the RSC round trip takes, and this page's round trip
  // is very long (the server component runs ~18 queries against a remote
  // database and re-renders the whole tree — measured at roughly 15-20 s of
  // server work on the live data set). One click therefore made the entire bar
  // — chips, both date pickers, Clear filters — uninteractive for the better
  // part of half a minute, with no way to correct a mis-click and no way to
  // tell a slow navigation from a dead one.
  //
  // Now the busy state is derived from the URL rather than from React's
  // scheduler: it ends the moment the router commits the query string we asked
  // for, and it is only ever a *notice*. Nothing is disabled, so a second click
  // always lands and supersedes the first (`router.replace` to a newer URL
  // wins), and the timeout below guarantees the notice clears even if the
  // navigation never lands at all.
  const [requestedQs, setRequestedQs] = useState<string | null>(null);
  // True once a request has been outstanding for longer than BUSY_NOTICE_MS.
  // The request is still outstanding — this only downgrades the claim the bar
  // is making from "updating" to "this may not have applied".
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (requestedQs === null) return;
    // The one and only way the notice ends: the URL on screen is now the URL
    // that was asked for, so the figures below it are the right ones.
    if (requestedQs === currentQs) {
      setRequestedQs(null);
      setStalled(false);
      return;
    }
    const timer = setTimeout(() => setStalled(true), BUSY_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [requestedQs, currentQs]);

  const pending = requestedQs !== null;
  /** In flight and not yet suspected of having failed. */
  const working = pending && !stalled;

  const apply = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(currentQs);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    // Carry the tab so a filter change can't bounce the owner back to Overview
    // if the client tree is ever remounted by the navigation.
    if (activeTab && activeTab !== "overview") next.set("tab", activeTab);
    else next.delete("tab");
    const qs = next.toString();
    // Re-picking what is already on screen is not a navigation.
    if (qs === currentQs) return;
    // A fresh click supersedes the previous one, including its stalled verdict —
    // the new request has not had its chance yet.
    setStalled(false);
    setRequestedQs(qs);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const positions: Array<{ key: IndustryFilter; count: number | null }> = [
    { key: "ALL", count: scopedJobCount },
    ...INDUSTRIES.map((i) => ({
      key: i.key as IndustryFilter,
      count: industryCounts[i.key] ?? 0,
    })),
  ];
  if (showUnspecified) {
    positions.push({
      key: INDUSTRY_UNSPECIFIED,
      count: industryCounts[INDUSTRY_UNSPECIFIED] ?? 0,
    });
  }

  // `industryCounts` is built by a reduce over the jobs in scope, so a position
  // whose real count is 0 has NO KEY at all. The chips have always handled that
  // with `?? 0` (above); the note below used `?? scopedJobCount` and therefore
  // fell through to the all-industries total — QA read "268 of 268 jobs ·
  // Airbnb" on `?industry=AIRBNB` while the Total jobs tile correctly said 0.
  //
  // Only ALL legitimately means "everything in scope". Every other position is
  // a lookup with a 0 default, exactly like its chip, so the note and the chip
  // can never disagree.
  const selectedJobCount =
    filters.industry === "ALL"
      ? scopedJobCount
      : (industryCounts[filters.industry] ?? 0);

  // Which industry the OUTSTANDING request asked for — `filters` still
  // describes the URL on screen, which during a stalled navigation is the one
  // the admin is trying to leave. Null when nothing is outstanding, when the
  // outstanding change was a date rather than an industry, or when the query
  // string names something this build doesn't recognise.
  const requestedIndustryLabel: string | null = (() => {
    if (requestedQs === null) return null;
    const raw = new URLSearchParams(requestedQs).get("industry");
    const requested: IndustryFilter | null = !raw
      ? "ALL"
      : isIndustryFilter(raw)
        ? raw
        : null;
    if (requested === null || requested === filters.industry) return null;
    return INDUSTRY_LABELS[requested];
  })();

  // A civil date is not an instant: cross the boundary explicitly rather than
  // handing "2026-08-01" to a formatter, which would read it as UTC midnight —
  // 8 PM on July 31 in Montréal — and print the day before.
  const civil = (d: string) => formatDate(storeCivilDayRange(d).start);
  const rangeLabel = filters.from
    ? filters.to
      ? `${civil(filters.from)} – ${civil(filters.to)}`
      : `From ${civil(filters.from)}`
    : filters.to
      ? `Until ${civil(filters.to)}`
      : null;

  return (
    <div
      className="an-filterbar dcard"
      // Both states dim the chip counts, because in both of them the counts on
      // screen belong to the PREVIOUS filter. `aria-busy` is dropped once the
      // request is stalled: a screen reader should hear the warning text below,
      // not sit forever on "busy".
      data-pending={working ? "1" : undefined}
      data-stalled={stalled ? "1" : undefined}
      aria-busy={working || undefined}>
      <div className="an-filterbar-row">
        <span className="an-filterbar-label" id="an-industry-label">
          Industry
        </span>
        <div
          className="an-chip-row"
          role="group"
          aria-labelledby="an-industry-label">
          {positions.map(({ key, count }) => {
            const active = filters.industry === key;
            return (
              <button
                key={key}
                type="button"
                className={`an-chip ${active ? "active" : ""}`}
                aria-pressed={active}
                onClick={() => apply({ industry: key === "ALL" ? null : key })}>
                {INDUSTRY_LABELS[key]}
                {count !== null && (
                  <span className="an-chip-count">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="an-filterbar-row">
        <span className="an-filterbar-label">Date range</span>
        <div className="an-daterange">
          <label>
            From
            <DatePicker
              size="sm"
              value={filters.from ?? ""}
              max={filters.to ?? undefined}
              placeholder="Any"
              onChange={(v) => apply({ from: v || null })}
            />
          </label>
          <label>
            To
            <DatePicker
              size="sm"
              value={filters.to ?? ""}
              min={filters.from ?? undefined}
              placeholder="Any"
              onChange={(v) => apply({ to: v || null })}
            />
          </label>
        </div>
        {filters.isFiltered && (
          <button
            type="button"
            className="btn btn-ghost btn-sm an-filterbar-clear"
            onClick={() => apply({ industry: null, from: null, to: null })}>
            Clear filters
          </button>
        )}
      </div>

      <p className="an-filterbar-note" aria-live="polite">
        {working && (
          // Says what is happening instead of freezing the controls. The
          // figures above are still the previous filter's, and this page takes
          // a long time to recompute them, so silence would read as nothing
          // having happened.
          <span className="an-filterbar-busy">
            Updating the figures below — this page is slow to recompute. You can
            change the filter again while it works.{" "}
          </span>
        )}
        {stalled && (
          // The honest version of what used to happen silently at 20s. The
          // request has not landed, the figures below are the OLD filter's, and
          // the bar says so rather than going quiet and letting them read as
          // current.
          <span className="an-filterbar-stalled">
            {requestedIndustryLabel
              ? `Still working, and ${requestedIndustryLabel} hasn’t applied yet — every figure below is the previous selection’s. `
              : "Still working, and that change hasn’t applied yet — every figure below is the previous selection’s. "}
            Pick the filter again, or reload the page.{" "}
          </span>
        )}
        {filters.isFiltered ? (
          <>
            <strong>
              {selectedJobCount} of {unfilteredJobCount} jobs
            </strong>{" "}
            {filters.industry !== "ALL"
              ? `· ${INDUSTRY_LABELS[filters.industry]}`
              : ""}
            {rangeLabel ? ` · ${rangeLabel}` : ""} · inventory, budgets and
            headcount are not job-derived and stay unfiltered.
          </>
        ) : (
          <>
            Showing all {unfilteredJobCount} jobs. Filters apply to the
            job-derived tabs only — Overview, KPIs, Graphs, Payments and
            Employees.
          </>
        )}
      </p>
    </div>
  );
}
