"use client";

import { useEffect, useState } from "react";
import { TrendingUp, DollarSign } from "lucide-react";
import {
  readCustomPayTotal,
  readJobFormMoney,
  type JobFormMoney,
} from "./form-money";

const EMPTY_MONEY: JobFormMoney = {
  price: 0,
  discount: 0,
  tip: 0,
  parking: 0,
  employeePay: 0,
  billedRate: 0,
  billedEstimated: 0,
  billedActual: 0,
  billedHours: 0,
  hourlyLine: 0,
  finalPriceMode: false,
  serviceLine: 0,
  payType: "PERCENTAGE",
  employeePayIsTeamTotal: false,
};

export default function PriceSummary() {
  // One object, read by `readJobFormMoney` — including Stage 8's billing fields
  // (so an hourly job's Pre-tax line shows `rate × hours` rather than the empty
  // Price box) and fix 2's pricing mode, which changes what `price` MEANS and
  // therefore what this figure can honestly be called. The reading moved into
  // form-money.ts when the per-cleaner pay cap started needing the same
  // numbers; two surfaces disagreeing about what a job is worth would be worse
  // than either being wrong alone.
  const [money, setMoney] = useState<JobFormMoney>(EMPTY_MONEY);
  // The `payFor_<id>` amounts from the crew picker, added up (fix list item
  // #10). Without this the Net margin below was a straight lie on exactly the
  // jobs that need it most: a $200 job paying two cleaners $150 each printed
  // "$200.00", because it only ever looked at the Employee pay box — which is
  // blank whenever the pay is set per person.
  const [customPay, setCustomPay] = useState(0);

  useEffect(() => {
    // Delegated from `document`, not bound per input.
    //
    // This used to attach one listener per element on mount, which was fine
    // while every field it watches existed for the whole life of the form.
    // Stage 8's billing inputs do NOT: they are mounted only once the admin
    // picks Hourly, so a per-element binding taken at mount would never see
    // them and the summary would sit at $0.00 on exactly the jobs this stage is
    // about. The `payFor_<id>` boxes are the same — they appear only once a
    // cleaner is assigned. One listener on the document re-reads whatever is on
    // screen now.
    const readAll = () => {
      setMoney(readJobFormMoney());
      setCustomPay(readCustomPayTotal());
    };

    readAll();
    document.addEventListener("input", readAll, true);
    return () => document.removeEventListener("input", readAll, true);
  }, []);

  const {
    discount,
    tip,
    parking,
    employeePay,
    billedRate,
    billedActual,
    billedHours,
    hourlyLine,
    finalPriceMode,
    serviceLine,
  } = money;

  const subtotal = serviceLine - discount + tip + parking;
  // What the crew actually costs, not what the Employee pay box says.
  //
  // `computeJobPayShares` pays a per-cleaner override off the top and splits
  // whatever is left of the team total between everyone else, flooring that
  // remainder at zero — so the crew's cost is the LARGER of the two figures,
  // never their sum. That is the same rule, one line of arithmetic instead of
  // a share map.
  //
  // Still an under-estimate in one case this component cannot fix: when only
  // SOME of the crew have a custom amount, the rest earn tier rates it has no
  // way to look up from the browser. Under-stating is the honest direction —
  // it never invents a cost — and it is strictly better than the $0 this line
  // used to assume.
  const crewPay = Math.max(employeePay, customPay);
  const margin = subtotal - crewPay;

  if (
    serviceLine === 0 &&
    discount === 0 &&
    tip === 0 &&
    parking === 0 &&
    crewPay === 0
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
      {/* Where the crew cost came from, whenever it is not just the Employee
          pay box. Without it the margin moved for a reason living in a
          different section of the form. */}
      {customPay > 0 && (
        <div style={{ fontSize: 12, color: "var(--primary-50)" }}>
          Crew pay ${crewPay.toFixed(2)}
          {customPay >= employeePay
            ? " — custom per-cleaner amounts"
            : ` — team total (custom amounts $${customPay.toFixed(2)})`}
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
