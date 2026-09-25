// The job form's money, read straight off the DOM.
//
// This page is an UNCONTROLLED form: the money boxes are plain `defaultValue`
// inputs and the pickers write into React-rendered hidden inputs, so the client
// components that have to REACT to the numbers can only reach them by id/name.
// PriceSummary has always done that inline. It is no longer the only one — the
// per-cleaner pay cap in CleanerSelector needs the same figures to know what
// this job can afford to pay a crew (fix list item #10) — and a summary that
// disagreed with the validator about what the job is worth would be worse than
// either of them being wrong on its own. So the reading happens here, once.
//
// Client-only by construction: every function below touches `document`.

/** Everything the two summary/validation surfaces read off this form. */
export interface JobFormMoney {
  price: number;
  discount: number;
  tip: number;
  parking: number;
  /** The Employee pay box — a team total when `employeePayIsTeamTotal`. */
  employeePay: number;
  billedRate: number;
  billedEstimated: number;
  billedActual: number;
  /** Actual hours when they have been measured, else the estimate. */
  billedHours: number;
  /** `rate × hours` on an hourly job, else 0. */
  hourlyLine: number;
  /** Pricing mode is FINAL_PRICE — the Price box IS the whole service total. */
  finalPriceMode: boolean;
  /** The service line this job bills: the hourly line, or the Price box. */
  serviceLine: number;
  /** The cleaner pay model — PERCENTAGE / FLAT / HOURLY. */
  payType: string;
  /**
   * True when the Employee pay figure is an ORDER (the crew's agreed total),
   * not a save-time estimate: FLAT, HOURLY, or the manual team total of D2.
   */
  employeePayIsTeamTotal: boolean;
}

/** A money box, by DOM id. Absent or unparseable reads as 0, never NaN. */
function num(id: string): number {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return el ? parseFloat(el.value) || 0 : 0;
}

/** A hidden picker mirror, by input name — PremiumSelect publishes the chosen
 *  value that way, which is how the selects on this form are readable at all. */
function text(name: string): string {
  return (
    document.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ??
    ""
  );
}

export function readJobFormMoney(): JobFormMoney {
  const price = num("price");
  const billedRate = num("billedHourlyRate");
  const billedEstimated = num("billedEstimatedHours");
  const billedActual = num("billedActualHours");
  // By id, not by name: PricingModeField renders an unnamed `#pricingMode`
  // mirror for exactly this, because a second NAMED field would post twice.
  const finalPriceMode =
    (document.getElementById("pricingMode") as HTMLInputElement | null)
      ?.value === "FINAL_PRICE";

  // On an hourly job the Price box is left blank and the service line is
  // `rate × hours` — actual when it has been measured, else the estimate. Same
  // precedence as `billedHours()` on the server; written out here rather than
  // imported because this reads raw DOM strings, not a job object.
  const billedHours = billedActual > 0 ? billedActual : billedEstimated;
  const hourlyLine =
    billedRate > 0 && billedHours > 0
      ? Math.round(billedRate * billedHours * 100) / 100
      : 0;

  const payType = text("payType") || "PERCENTAGE";

  return {
    price,
    discount: num("discountAmount"),
    tip: num("totalTip"),
    parking: num("parking"),
    employeePay: num("employeePay"),
    billedRate,
    billedEstimated,
    billedActual,
    billedHours,
    hourlyLine,
    finalPriceMode,
    // A FINAL_PRICE override IS the service total, so the hourly derivation
    // never overrules it.
    serviceLine: hourlyLine > 0 && !finalPriceMode ? hourlyLine : price,
    payType,
    employeePayIsTeamTotal:
      text("employeePayIsManual") === "on" ||
      payType === "FLAT" ||
      payType === "HOURLY",
  };
}

/**
 * The crew's pay ceiling for this job, as the form currently stands — the
 * client-side half of `checkCustomCleanerPay`'s budget, derived from the same
 * two rules: an agreed team total when one has been stated, otherwise what the
 * work itself is worth.
 *
 * `addOnTotal` comes from the server (this page has no add-on editor, but it IS
 * an editor, so a job being edited can already own add-on rows). It is additive
 * under itemized pricing and already inside the number under a final-price
 * override — the same split `addOnMoneyBasis` makes server-side.
 *
 * Deliberately the GENEROUS reading wherever the two could differ: the server
 * check is the authority, and a client ceiling that came in low would refuse
 * pay the server would have allowed.
 */
export function crewPayBudget(
  money: JobFormMoney,
  addOnTotal: number
): { amount: number; fromTeamTotal: boolean } {
  if (money.employeePayIsTeamTotal && money.employeePay > 0) {
    return { amount: money.employeePay, fromTeamTotal: true };
  }
  const addOns = money.finalPriceMode ? 0 : Math.max(0, addOnTotal);
  return {
    amount: Math.max(0, money.serviceLine) + addOns,
    fromTeamTotal: false,
  };
}

/**
 * The per-cleaner amounts currently typed into the crew picker, added up.
 *
 * Read by name prefix rather than passed down, because the two components that
 * need this total are siblings: CleanerSelector owns the `payFor_<id>` boxes,
 * PriceSummary sits several sections below them and has no path to their state.
 * Blank boxes mean "use the automatic amount" and contribute nothing.
 */
export function readCustomPayTotal(): number {
  const inputs = document.querySelectorAll<HTMLInputElement>(
    'input[name^="payFor_"]'
  );
  let total = 0;
  for (const el of inputs) {
    const n = parseFloat(el.value);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return Math.round(total * 100) / 100;
}
