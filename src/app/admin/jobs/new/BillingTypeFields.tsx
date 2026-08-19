"use client";

// How the CUSTOMER is billed, for the full-page job form (Stage 8 / PDF #8).
// The modal at admin/jobs/JobModal.tsx carries the same control; both post
// `billingType` / `billedHourlyRate` / `billedEstimatedHours` /
// `billedActualHours`, and the two save paths resolve them identically.
//
// ## Decision D6, made visible
//
// This block lives in a "Customer billing" panel and every label says
// *customer*. `PayTypeFields` — the CLEANER's pay model, including its own
// "Hourly rate" — is a separate control in a separate panel. Two hourly rates
// on one form is a genuine trap, so the wording is the guard: nothing here ever
// says "pay", and nothing there ever says "billed".
//
// Actual hours are read-only until the job has been worked: they are measured
// from the work sessions at clock-out (rounded to 0.25h, decision D7). An admin
// can correct the measurement afterwards, which is why the input unlocks once a
// figure exists rather than staying locked forever.
//
// Both hour fields are TOTAL CREW HOURS (round 4, fix 4): 2 cleaners × 15h is
// 30, and the rate is multiplied by that figure exactly once. The estimate and
// the measurement share the unit, which is why the helper text under each one
// says the same sentence.
import { useState } from "react";
import PremiumSelect from "@/components/ui/PremiumSelect";
import Input from "@/components/ui/Input";
import {
  BILLING_TYPE_HINT,
  BILLING_TYPE_LABEL,
  BILLED_HOURS_INCREMENT,
  formatHours,
  hourlyServiceAmount,
  type JobBillingType,
} from "@/lib/hourly-billing";

const BILLING_TYPE_OPTIONS = [
  { value: "FLAT", label: BILLING_TYPE_LABEL.FLAT },
  { value: "HOURLY", label: BILLING_TYPE_LABEL.HOURLY },
];

interface BillingTypeFieldsProps {
  defaultValue?: string | null;
  defaultHourlyRate?: number | null;
  defaultEstimatedHours?: number | null;
  defaultActualHours?: number | null;
  /** Actual hours are only editable once the job has been worked or corrected. */
  actualHoursEditable?: boolean;
}

export default function BillingTypeFields({
  defaultValue,
  defaultHourlyRate,
  defaultEstimatedHours,
  defaultActualHours,
  actualHoursEditable = false,
}: BillingTypeFieldsProps) {
  const [billingType, setBillingType] = useState<JobBillingType>(
    defaultValue === "HOURLY" ? "HOURLY" : "FLAT"
  );
  const [rate, setRate] = useState(
    defaultHourlyRate != null ? String(defaultHourlyRate) : ""
  );
  const [estimated, setEstimated] = useState(
    defaultEstimatedHours != null ? String(defaultEstimatedHours) : ""
  );
  const [actual, setActual] = useState(
    defaultActualHours != null ? String(defaultActualHours) : ""
  );

  // The same helper the server and the modal use, so the figure previewed here
  // is the figure that gets saved.
  const derived = hourlyServiceAmount({
    billingType,
    billedHourlyRate: parseFloat(rate),
    billedEstimatedHours: parseFloat(estimated),
    billedActualHours: parseFloat(actual),
  });
  const usingActual = (parseFloat(actual) || 0) > 0;

  return (
    <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
      <div className="md:col-span-2">
        <FieldLabel label="Customer billing" />
        <PremiumSelect
          name="billingType"
          value={billingType}
          onChange={(v) => setBillingType(v as JobBillingType)}
          options={BILLING_TYPE_OPTIONS}
          size="md"
        />
        <p style={{ marginTop: 6, fontSize: 12, color: "var(--primary-50)" }}>
          {BILLING_TYPE_HINT[billingType]}
          {billingType === "HOURLY" && (
            <>
              {" "}
              The <strong>Price</strong> field is set from the rate and hours on
              save — leave it blank.
            </>
          )}
        </p>
      </div>

      {billingType === "HOURLY" && (
        <>
          <div>
            <FieldLabel label="Customer hourly rate" />
            <MoneyInput
              id="billedHourlyRate"
              name="billedHourlyRate"
              value={rate}
              onChange={setRate}
            />
            <p style={{ marginTop: 6, fontSize: 12, color: "var(--primary-50)" }}>
              What the customer pays per hour. Not the cleaner&apos;s rate.
            </p>
          </div>

          <div>
            <FieldLabel label="Estimated hours" />
            <HoursInput
              id="billedEstimatedHours"
              name="billedEstimatedHours"
              value={estimated}
              onChange={setEstimated}
            />
            <p style={{ marginTop: 6, fontSize: 12, color: "var(--primary-50)" }}>
              Total job hours across all cleaners — 2 cleaners × 15h is 30.
            </p>
          </div>

          <div>
            <FieldLabel label="Actual hours" />
            <HoursInput
              id="billedActualHours"
              name="billedActualHours"
              value={actual}
              onChange={setActual}
              readOnly={!actualHoursEditable}
            />
            <p style={{ marginTop: 6, fontSize: 12, color: "var(--primary-50)" }}>
              {actualHoursEditable
                ? `Every cleaner's clocked time added up, to the nearest ${BILLED_HOURS_INCREMENT}h. Correct it here if the clock was wrong.`
                : "Filled in automatically when the crew clocks out — every cleaner's time added up."}
            </p>
          </div>

          <div className="flex items-end">
            <div
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 10,
                background: "rgba(0,140,156,0.06)",
                border: "1px solid rgba(0,140,156,0.12)",
              }}
            >
              <div style={{ fontSize: 12, color: "var(--primary-60)" }}>
                Service total {usingActual ? "(actual hours)" : "(estimate)"}
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "var(--ink)" }}>
                {derived === null ? "—" : `$${derived.toFixed(2)}`}
              </div>
              {derived !== null && (
                <div style={{ fontSize: 11, color: "var(--primary-50)" }}>
                  {formatHours(
                    usingActual ? parseFloat(actual) : parseFloat(estimated)
                  )}{" "}
                  × ${(parseFloat(rate) || 0).toFixed(2)}/hr · before add-ons and
                  tax
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MoneyInput({
  id,
  name,
  value,
  onChange,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <span
        className="absolute left-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none"
        style={{ color: "var(--primary-50)" }}
      >
        $
      </span>
      <Input
        type="number"
        step="0.01"
        min="0"
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
        className="pl-7"
      />
    </div>
  );
}

function HoursInput({
  id,
  name,
  value,
  onChange,
  readOnly,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  /**
   * `readOnly`, deliberately NOT `disabled`: a disabled input posts nothing, so
   * locking the Actual hours box would have made every save null out a figure
   * the clock-out had just measured.
   */
  readOnly?: boolean;
}) {
  return (
    <div className="relative">
      <Input
        type="number"
        step={BILLED_HOURS_INCREMENT}
        min="0"
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        readOnly={readOnly}
        className={`pr-8 ${readOnly ? "opacity-60" : ""}`}
      />
      <span
        className="absolute right-3 top-1/2 -translate-y-1/2 text-sm pointer-events-none"
        style={{ color: "var(--primary-50)" }}
      >
        h
      </span>
    </div>
  );
}

function FieldLabel({ label }: { label: string }) {
  return (
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
      {label}
    </label>
  );
}
