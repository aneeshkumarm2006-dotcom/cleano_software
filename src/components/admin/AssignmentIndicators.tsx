"use client";

// The per-cleaner indicators the two admin crew pickers share — the New Job
// form's CleanerSelector and the Jobs/Calendar JobModal.
//
// They lived only in CleanerSelector, so when JobModal grew the same feature
// (awerfixes.pdf item 19) there was nothing to import and the two would have
// drifted immediately: same colours, same meanings, two implementations. Both
// pickers now render these.
//
// Everything here is ADVISORY. Nothing renders a disabled state, and no caller
// may use these to block a save — an admin knowingly booking a cleaner outside
// their hours or their approved categories is an allowed decision.

import { CheckCircle2, AlertTriangle, X, ShieldAlert } from "lucide-react";
import type { EmployeeAvailabilityStatus } from "@/app/admin/actions/checkAvailability.types";

/**
 * Availability at a glance: green = inside their hours, red = marked
 * unavailable or a blocked date, amber = outside normal hours. A cleaner who
 * never entered availability (NO_DATA) renders nothing — we don't nag admins
 * about a form the cleaner hasn't filled in.
 */
export function StatusIndicator({
  status,
}: {
  status: EmployeeAvailabilityStatus | undefined;
}) {
  if (!status || status.result === "NO_DATA") return null;
  if (status.result === "AVAILABLE") {
    return (
      <span title="Available" className="inline-flex items-center text-green-600">
        <CheckCircle2 className="w-3.5 h-3.5" />
      </span>
    );
  }
  if (status.result === "UNAVAILABLE") {
    return (
      <span
        title={status.reason ?? "Marked unavailable"}
        className="inline-flex items-center text-red-600">
        <X className="w-3.5 h-3.5" />
      </span>
    );
  }
  return (
    <span
      title={status.reason ?? "Outside normal hours"}
      className="inline-flex items-center text-yellow-600">
      <AlertTriangle className="w-3.5 h-3.5" />
    </span>
  );
}

/**
 * Service-category mismatch (awerfixes.pdf item 3). Renders only when the
 * cleaner is NOT approved for this job's category, so an unrestricted cleaner —
 * the default — shows nothing at all.
 */
export function CategoryIndicator({ warning }: { warning: string | null }) {
  if (!warning) return null;
  return (
    <span title={warning} className="inline-flex items-center text-amber-600">
      <ShieldAlert className="w-3.5 h-3.5" />
    </span>
  );
}

/** One advisory line in the amber panel. */
export interface AssignmentAdvisory {
  cleanerId: string;
  cleanerName: string;
  detail: string;
}

/**
 * The amber advisory panel both pickers show under the crew list: availability
 * clashes, service-category mismatches, and the "nobody is free" case, in one
 * block rather than three competing ones.
 *
 * The closing line is deliberately load-bearing copy — the PDF asks for a
 * warning that never blocks, and this is where the admin is told so.
 */
export function AssignmentWarningPanel({
  availability,
  categories,
  noCoverage = false,
  availabilityState = "loaded",
}: {
  availability: AssignmentAdvisory[];
  categories: AssignmentAdvisory[];
  /** Every candidate is unavailable for the chosen slot. */
  noCoverage?: boolean;
  /**
   * Where the availability lookup has got to. Defaults to "loaded" so the
   * callers that pass nothing behave exactly as before.
   *
   * This exists because the lookup is a server round trip and can take several
   * seconds. While it was in flight the panel rendered NOTHING, which is the
   * same thing it renders when a cleaner is perfectly free — so a slow answer
   * was indistinguishable from a clean one, and the feature was reported as
   * dead when it was merely late.
   */
  availabilityState?: "idle" | "loading" | "loaded" | "error";
}) {
  const hasWarnings =
    availability.length > 0 || categories.length > 0 || noCoverage;
  const showStatusLine =
    availabilityState === "loading" || availabilityState === "error";

  if (!hasWarnings && !showStatusLine) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
      {availabilityState === "loading" && (
        <div className="flex items-center gap-2 text-xs text-amber-800">
          <span
            aria-hidden
            className="inline-block w-3 h-3 rounded-full border-2 border-amber-400 border-t-transparent animate-spin"
          />
          Checking cleaner availability…
        </div>
      )}

      {availabilityState === "error" && (
        <div
          role="alert"
          className="flex items-center gap-2 text-xs text-amber-900">
          <AlertTriangle className="w-3.5 h-3.5" />
          Couldn&apos;t check availability — change the date or time to retry.
          Category checks below are unaffected.
        </div>
      )}

      {noCoverage && (
        <div
          className={`flex items-center gap-2 text-sm font-semibold text-amber-900${
            showStatusLine ? " mt-2" : ""
          }`}>
          <AlertTriangle className="w-4 h-4" />
          No cleaner is available for this time slot.
        </div>
      )}

      {availability.length > 0 && (
        <>
          <div
            className={`flex items-center gap-2 text-sm font-semibold text-amber-900${
              noCoverage || showStatusLine ? " mt-2" : ""
            }`}>
            <AlertTriangle className="w-4 h-4" />
            Availability conflict
          </div>
          <ul className="mt-1.5 space-y-1">
            {availability.map((a) => (
              <li key={`av-${a.cleanerId}`} className="text-xs text-amber-800">
                <span className="font-medium">{a.cleanerName}</span>
                {" — "}
                {a.detail}
                {" · "}
                <a
                  href={`/admin/employees/${a.cleanerId}?tab=availability`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline">
                  View availability
                </a>
              </li>
            ))}
          </ul>
        </>
      )}

      {categories.length > 0 && (
        <>
          <div
            className={`flex items-center gap-2 text-sm font-semibold text-amber-900${
              noCoverage || availability.length > 0 || showStatusLine
                ? " mt-2.5"
                : ""
            }`}>
            <ShieldAlert className="w-4 h-4" />
            Service category mismatch
          </div>
          <ul className="mt-1.5 space-y-1">
            {categories.map((c) => (
              <li key={`cat-${c.cleanerId}`} className="text-xs text-amber-800">
                <span className="font-medium">{c.cleanerName}</span>
                {" — "}
                {c.detail}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* The PDF asks for a warning that never blocks, and this is where the
          admin is told so — but only when there IS a warning. Printing it under
          a bare "checking…" line would promise an override nobody has been
          offered yet. */}
      {hasWarnings && (
        <p className="mt-1.5 text-xs text-amber-700">
          You can still book them — this is only a warning.
        </p>
      )}
    </div>
  );
}
