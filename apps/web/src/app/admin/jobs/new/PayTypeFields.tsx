"use client";

// Cleaner pay-model picker for the job form (item 9).
//   • Percentage (default) — existing tier/split behaviour; the cleaner's payout
//     is estimated from pay tiers. "Employee pay" acts as an override.
//   • Flat rate — the admin types the cleaner's fixed payout in "Employee pay";
//     the cleaner is shown only that amount (never a % of the job price).
//   • Hourly — the admin enters an hourly rate; payout is rate × hours (or the
//     "Employee pay" override, if entered).
import { useState } from "react";
import PremiumSelect from "@/components/ui/PremiumSelect";
import Input from "@/components/ui/Input";

const PAY_TYPE_OPTIONS = [
  { value: "PERCENTAGE", label: "Percentage (tier split)" },
  { value: "FLAT", label: "Flat rate" },
  { value: "HOURLY", label: "Hourly" },
];

interface PayTypeFieldsProps {
  defaultValue?: string | null;
  defaultHourlyRate?: number | null;
}

export default function PayTypeFields({
  defaultValue,
  defaultHourlyRate,
}: PayTypeFieldsProps) {
  const [payType, setPayType] = useState(defaultValue || "PERCENTAGE");

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
      <div>
        <FieldLabel label="Pay type" />
        <PremiumSelect
          name="payType"
          value={payType}
          onChange={setPayType}
          options={PAY_TYPE_OPTIONS}
          size="md"
        />
        <p style={{ marginTop: 6, fontSize: 12, color: "var(--primary-50)" }}>
          {payType === "PERCENTAGE"
            ? "Payout estimated from pay tiers. Enter Employee pay to override."
            : payType === "FLAT"
              ? "Cleaner is paid the fixed amount you enter in Employee pay."
              : "Cleaner is paid the hourly rate below (× hours), or the Employee pay override."}
        </p>
      </div>

      {payType === "HOURLY" && (
        <div>
          <FieldLabel label="Hourly rate" />
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
              id="hourlyRate"
              name="hourlyRate"
              defaultValue={defaultHourlyRate ?? ""}
              placeholder="0.00"
              className="pl-7"
            />
          </div>
        </div>
      )}
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
