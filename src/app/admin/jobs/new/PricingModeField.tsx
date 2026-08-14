"use client";

// Itemized vs Final price override, for the full-page job form
// (cleano_new_fixes.pdf fix 2). The modal at admin/jobs/JobModal.tsx carries the
// same control; both post the same `pricingMode` field, and the server resolves
// it identically in saveJob.
//
// Why the mode is a stored CHOICE and not a guess: it used to be derived from
// `bookingSource`, and re-derived on every save from whether the price field
// still matched the stored price. An admin retyping the price of a web booking
// or a BookingKoala import silently flipped it to itemized, at which point that
// job's add-ons started ADDING to a total that already contained them.
//
// This page has no add-on editor of its own — it is still an EDITOR (?edit=<id>),
// so the job's existing add-on rows are priced by whatever mode is chosen here.
// That is exactly why the control has to exist on this form too: without it,
// saving from this page would have to fall back to inference again.
import { useEffect, useRef, useState } from "react";
import PremiumSelect from "@/components/ui/PremiumSelect";
import {
  PRICING_MODE_HINT,
  PRICING_MODE_LABEL,
  type JobPricingMode,
} from "@/lib/job-money";

const OPTIONS = [
  { value: "ITEMIZED", label: PRICING_MODE_LABEL.ITEMIZED },
  { value: "FINAL_PRICE", label: PRICING_MODE_LABEL.FINAL_PRICE },
];

export default function PricingModeField({
  defaultValue,
  /** Live add-on total on the job being edited, so the hint can name real money. */
  addOnTotal = 0,
}: {
  defaultValue: JobPricingMode;
  addOnTotal?: number;
}) {
  const [mode, setMode] = useState<JobPricingMode>(defaultValue);
  const [recalculate, setRecalculate] = useState(false);

  // PriceSummary is a sibling, not a child, and this page has no shared store —
  // it subscribes to the form's fields by DOM id and `input` events (see its
  // own comment). The mirror input below joins that convention so the summary
  // can relabel itself when the mode changes; React never fires `input` for a
  // value it sets itself, hence the explicit dispatch.
  const mirrorRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mirrorRef.current?.dispatchEvent(new Event("input", { bubbles: true }));
  }, [mode]);

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
        Pricing mode
      </label>
      <PremiumSelect
        name="pricingMode"
        value={mode}
        onChange={(v) => {
          setMode(v as JobPricingMode);
          // The checkbox only means anything while the job is still on an
          // override; switching to itemized by hand already IS the recalculate.
          if (v !== "FINAL_PRICE") setRecalculate(false);
        }}
        options={OPTIONS}
        size="md"
      />
      {/* Read-only mirror for PriceSummary. Not `name`d — PremiumSelect already
          posts `pricingMode`, and a second field of the same name would submit
          twice. */}
      <input ref={mirrorRef} id="pricingMode" type="hidden" value={mode} readOnly />
      <p style={{ marginTop: 6, fontSize: 12, color: "var(--primary-50)" }}>
        {PRICING_MODE_HINT[mode]}
        {mode === "FINAL_PRICE" && (
          <>
            {" "}
            The <strong>Price</strong> field above is this job&apos;s service
            total.
          </>
        )}
      </p>

      {mode === "FINAL_PRICE" && (
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            marginTop: 10,
            fontSize: 13,
            color: "var(--primary-60)",
          }}
        >
          <input
            type="checkbox"
            name="recalculateFromItems"
            checked={recalculate}
            onChange={(e) => setRecalculate(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <span>
            Recalculate from items on save — switch this job to itemized pricing
            and price it as base + add-ons
            {addOnTotal > 0 ? ` (currently $${addOnTotal.toFixed(2)} of add-ons)` : ""}.
          </span>
        </label>
      )}
    </div>
  );
}
