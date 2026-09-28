// Pay, in words a cleaner reads at a glance. Money is cents all the way to the
// screen and formatted in the company's currency; dates in the pay contract
// are calendar dates, so they are formatted as dates, never shifted by a zone.
import type { PayPeriodSummary, Withdrawal } from "@bookmops/api/v1";
import type { PillProps } from "@bookmops/ui-native";

const LOCALE = "en-CA";
const dm = new Intl.DateTimeFormat(LOCALE, { timeZone: "UTC", day: "numeric", month: "short" });
const dmy = new Intl.DateTimeFormat(LOCALE, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

/** A LocalDate at noon UTC, so formatting it in UTC can never move the day. */
const asDate = (localDate: string) => new Date(`${localDate}T12:00:00Z`);

function dayMonth(localDate: string, withYear = false): string {
  const parts = (withYear ? dmy : dm).formatToParts(asDate(localDate));
  const get = (t: string) => parts.find((p) => p.type === t)?.value.replace(".", "") ?? "";
  return withYear ? `${get("day")} ${get("month")} ${get("year")}` : `${get("day")} ${get("month")}`;
}

/** "15 – 28 Sep", "29 Sep – 5 Oct", "29 Dec 2025 – 4 Jan 2026". */
export function periodRange(startDate: string, endDate: string): string {
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
  if (!sameYear) return `${dayMonth(startDate, true)} – ${dayMonth(endDate, true)}`;
  if (startDate.slice(0, 7) === endDate.slice(0, 7)) return `${Number(startDate.slice(8, 10))} – ${dayMonth(endDate)}`;
  return `${dayMonth(startDate)} – ${dayMonth(endDate)}`;
}

/** "41.5 h". */
export const hoursText = (h: number) => `${(Math.round(h * 10) / 10).toFixed(1)} h`;

/** "14 jobs · 41.5 h". */
export const periodLine = (p: Pick<PayPeriodSummary, "jobCount" | "hours">) =>
  `${p.jobCount} job${p.jobCount === 1 ? "" : "s"} · ${hoursText(p.hours)}`;

const PERIOD: Record<string, { label: string; tone: PillProps["tone"] }> = {
  OPEN: { label: "This week", tone: "accent" },
  DRAFT: { label: "Being prepared", tone: "neutral" },
  APPROVED: { label: "Approved", tone: "accent" },
  PAID: { label: "Paid", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
};
export const periodStatus = (s: string) => PERIOD[s] ?? { label: "Pay period", tone: "neutral" as const };

const WITHDRAWAL: Record<string, { label: string; tone: PillProps["tone"] }> = {
  PENDING: { label: "Requested", tone: "warning" },
  APPROVED: { label: "Approved", tone: "accent" },
  REJECTED: { label: "Declined", tone: "danger" },
  COMPLETED: { label: "Paid", tone: "success" },
};
export const withdrawalStatus = (s: Withdrawal["status"]) => WITHDRAWAL[s] ?? { label: "Withdrawal", tone: "neutral" as const };

/**
 * An amount typed by a person, to integer cents, without floating point:
 * "12", "12.5", "12,50", "$1234.00". Null for anything else, including more
 * than two decimals, so "12.345" is refused rather than rounded behind their back.
 */
export function parseAmount(input: string): number | null {
  const m = /^\s*\$?\s*(\d{1,7})(?:[.,](\d{0,2}))?\s*$/.exec(input);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * The fee on an amount, as the server will compute it: basis points, rounded
 * to the cent, and at least 1 cent whenever the rate and amount are above 0.
 */
export const feeCents = (amountCents: number, feeBasisPoints: number) =>
  amountCents <= 0 || feeBasisPoints <= 0 ? 0 : Math.max(1, Math.round((amountCents * feeBasisPoints) / 10_000));

/** "5%", "2.5%". */
export const percentText = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
