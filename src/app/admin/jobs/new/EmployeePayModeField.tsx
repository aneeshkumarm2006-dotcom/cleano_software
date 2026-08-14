"use client";

// Is the Employee pay figure an ORDER or a save-time estimate?
// (cleano_new_fixes.pdf fix 4, decision D2.)
//
// The modal at admin/jobs/JobModal.tsx carries the same control inline under its
// Employee pay input; both post the same `employeePayIsManual` field and saveJob
// resolves it identically. This form is a full-page EDITOR (?edit=<id>), so
// without the control here a save from this page could only guess — and the one
// guess available ("a value is present in the box") is wrong, because the box is
// PREFILLED from the stored column on every edit. Guessing that way would flag
// the whole database manual on the next save and freeze every job at a stale
// snapshot. See the long note in saveJob.ts.
//
// MANUAL   the number in Employee pay is the crew's TOTAL pay for the job,
//          split evenly (minus any per-cleaner amount). It beats the tier
//          calculation until an admin clears it — the PDF's "manual cleaner pay
//          overrides the automatic calculation until admin clears it".
// AUTOMATIC every cleaner earns their own tier rate on the job's active value
//          (base + add-ons, or the override total). The stored figure is an
//          estimate the live calculation supersedes.
import { useEffect, useState } from "react";
import PremiumSelect from "@/components/ui/PremiumSelect";

const OPTIONS = [
  { value: "off", label: "Automatic (tier rates)" },
  { value: "on", label: "Manual amount — team total, split evenly" },
];

export default function EmployeePayModeField({
  defaultValue,
}: {
  /** The job's stored `employeePayIsManual`. FALSE for a new job. */
  defaultValue: boolean;
}) {
  const [manual, setManual] = useState(defaultValue);

  // Keep the pay field's own affordance honest: clearing the box can never be a
  // manual team total, so switching to Automatic empties it and lets the server
  // re-estimate. The field is a sibling in an uncontrolled form, reached by DOM
  // id — the same convention PriceSummary and PricingModeField already use here.
  useEffect(() => {
    if (manual) return;
    const el = document.getElementById(
      "employeePay"
    ) as HTMLInputElement | null;
    if (el && el.value !== "") {
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, [manual]);

  return (
    <div className="md:col-span-2">
      <label
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--primary-60)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 6,
        }}
      >
        Cleaner pay source
      </label>
      <PremiumSelect
        name="employeePayIsManual"
        value={manual ? "on" : "off"}
        onChange={(v) => setManual(v === "on")}
        options={OPTIONS}
        size="md"
      />
      <p style={{ marginTop: 6, fontSize: 12, color: "var(--primary-50)" }}>
        {manual ? (
          <>
            The <strong>Employee pay</strong> figure above is the crew&apos;s
            total for this job and is split evenly between them. Switch back to
            Automatic to clear it and use the tier calculation.
          </>
        ) : (
          <>
            Each cleaner earns their own tier rate on the job&apos;s active value
            — base price plus add-ons, or the override total. Leave{" "}
            <strong>Employee pay</strong> blank.
          </>
        )}
      </p>
    </div>
  );
}
