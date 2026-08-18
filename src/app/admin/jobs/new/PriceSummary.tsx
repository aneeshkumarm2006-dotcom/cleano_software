"use client";

import { useEffect, useState } from "react";
import { TrendingUp, DollarSign } from "lucide-react";

export default function PriceSummary() {
  const [price, setPrice] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [tip, setTip] = useState(0);
  const [parking, setParking] = useState(0);
  const [employeePay, setEmployeePay] = useState(0);
  // Customer-side hourly billing (Stage 8). Subscribed by DOM id like every
  // other field here, so an hourly job's Pre-tax line shows `rate × hours`
  // rather than the empty Price box. Without this the summary read $0.00 on
  // exactly the jobs PDF #8 is about.
  const [billedRate, setBilledRate] = useState(0);
  const [billedEstimated, setBilledEstimated] = useState(0);
  const [billedActual, setBilledActual] = useState(0);
  // Not money — the pricing mode (fix 2), mirrored into a hidden input by
  // PricingModeField so this component can subscribe the same way it does to
  // every other field. It changes what `price` MEANS, and therefore what this
  // figure can honestly be called.
  const [finalPriceMode, setFinalPriceMode] = useState(false);

  useEffect(() => {
    const fields = [
      { id: "price", setter: setPrice },
      { id: "discountAmount", setter: setDiscount },
      { id: "totalTip", setter: setTip },
      { id: "parking", setter: setParking },
      { id: "employeePay", setter: setEmployeePay },
      { id: "billedHourlyRate", setter: setBilledRate },
      { id: "billedEstimatedHours", setter: setBilledEstimated },
      { id: "billedActualHours", setter: setBilledActual },
    ];

    // Delegated from `document`, not bound per input.
    //
    // This used to attach one listener per element on mount, which was fine
    // while every field it watches existed for the whole life of the form.
    // Stage 8's billing inputs do NOT: they are mounted only once the admin
    // picks Hourly, so a per-element binding taken at mount would never see
    // them and the summary would sit at $0.00 on exactly the jobs this stage is
    // about. One listener on the document re-reads whatever is on screen now.
    const readAll = () => {
      for (const { id, setter } of fields) {
        const el = document.getElementById(id) as HTMLInputElement | null;
        setter(el ? parseFloat(el.value) || 0 : 0);
      }
      const modeEl = document.getElementById(
        "pricingMode"
      ) as HTMLInputElement | null;
      setFinalPriceMode(modeEl?.value === "FINAL_PRICE");
    };

    readAll();
    document.addEventListener("input", readAll, true);
    return () => document.removeEventListener("input", readAll, true);
  }, []);

  // On an hourly job the Price box is left blank and the service line is
  // `rate × hours` — actual when it has been measured, else the estimate. Same
  // precedence as `billedHours()` on the server; kept inline because this
  // component reads raw DOM strings rather than a job object.
  const billedHours = billedActual > 0 ? billedActual : billedEstimated;
  const hourlyLine =
    billedRate > 0 && billedHours > 0
      ? Math.round(billedRate * billedHours * 100) / 100
      : 0;
  const serviceLine = hourlyLine > 0 && !finalPriceMode ? hourlyLine : price;

  const subtotal = serviceLine - discount + tip + parking;
  const margin = subtotal - employeePay;

  if (
    serviceLine === 0 &&
    discount === 0 &&
    tip === 0 &&
    parking === 0 &&
    employeePay === 0
  ) {
    return null;
  }

  return (
    <div
      style={{
        marginTop: 20,
        padding: "16px 20px",
        background: "rgba(0,140,156,0.04)",
        border: "1px solid rgba(0,140,156,0.10)",
        borderRadius: 12,
        display: "flex",
        gap: 24,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <DollarSign size={15} style={{ color: "var(--primary-60)" }} />
        {/* Not the client total: this figure excludes tax, and under itemized
            pricing it also excludes the add-ons — it reads the form's inputs by
            DOM id, so it cannot see either. Under a final price override there
            are no add-ons to miss: the Price field IS the service total, so the
            caveat would be a lie. The job detail page and the modal's preview
            both show the real total either way. */}
        <span style={{ fontSize: 13, color: "var(--primary-60)" }}>
          {finalPriceMode
            ? "Pre-tax (service total override)"
            : "Pre-tax (excl. add-ons & tax)"}
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", marginLeft: 4 }}>
          ${subtotal.toFixed(2)}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <TrendingUp size={15} style={{ color: "var(--primary-60)" }} />
        <span style={{ fontSize: 13, color: "var(--primary-60)" }}>
          Net margin
        </span>
        <span
          style={{
            fontSize: 15,
            fontWeight: 700,
            marginLeft: 4,
            color: margin >= 0 ? "var(--emerald-600)" : "var(--error)",
          }}
        >
          ${margin.toFixed(2)}
        </span>
      </div>
      {discount > 0 && (
        <div style={{ fontSize: 12, color: "var(--primary-50)" }}>
          −${discount.toFixed(2)} discount applied
        </div>
      )}
      {/* Says where the service line came from on an hourly job, so the
          Pre-tax figure is never a number with no visible origin. */}
      {hourlyLine > 0 && !finalPriceMode && (
        <div style={{ fontSize: 12, color: "var(--primary-50)" }}>
          Hourly · {billedHours}h × ${billedRate.toFixed(2)}/hr = $
          {hourlyLine.toFixed(2)}
          {billedActual > 0 ? " (actual)" : " (estimate)"}
        </div>
      )}
    </div>
  );
}
