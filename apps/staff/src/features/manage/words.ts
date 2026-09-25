// The manager screens' words for the contract's vocabularies, and the tone
// each reads in. A value from a newer server (UNKNOWN, or anything not
// listed) gets a neutral fallback rather than a blank.
import type { CrewState, JobAttention, PaymentMethod } from "@bookmops/api/v1";
import { JOB_ISSUE_CATEGORY_LABEL } from "@bookmops/core/jobs";
import type { PillTone } from "@bookmops/ui-native";

export const CREW_STATE: Record<CrewState, { label: string; tone: PillTone }> = {
  LATE: { label: "Late", tone: "danger" },
  ON_BREAK: { label: "On break", tone: "warning" },
  CLOCKED_IN: { label: "Clocked in", tone: "accent" },
  NOT_STARTED: { label: "Not started", tone: "neutral" },
  DONE: { label: "Done", tone: "success" },
};

export function crewState(state: string): { label: string; tone: PillTone } {
  return CREW_STATE[state as CrewState] ?? { label: "Unknown", tone: "neutral" };
}

export const ATTENTION: Record<JobAttention, { label: string; tone: PillTone }> = {
  UNASSIGNED: { label: "No cleaner", tone: "danger" },
  SHORT_STAFFED: { label: "Short-staffed", tone: "warning" },
  LATE_START: { label: "Late start", tone: "danger" },
  ISSUE_OPEN: { label: "Problem reported", tone: "warning" },
};

export function attention(a: string): { label: string; tone: PillTone } | null {
  return ATTENTION[a as JobAttention] ?? null;
}

export const JOB_STATUS: Record<string, { label: string; tone: PillTone }> = {
  CREATED: { label: "On hold", tone: "neutral" },
  SCHEDULED: { label: "Scheduled", tone: "accent" },
  IN_PROGRESS: { label: "In progress", tone: "accent" },
  COMPLETED: { label: "Done", tone: "success" },
  PAID: { label: "Paid", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
};

export const jobStatus = (s: string) => JOB_STATUS[s] ?? { label: "Job", tone: "neutral" as const };

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  E_TRANSFER: "E-Transfer",
  CASH: "Cash",
  CHEQUE: "Cheque",
  CREDIT_CARD: "Card",
  OTHER: "Other",
};

export const paymentMethodLabel = (m: string | null) => (m ? (PAYMENT_METHOD_LABEL[m as PaymentMethod] ?? "Other") : null);

/** "Requested", "Approved", "Paid", "Rejected": the web's words for the stored states. */
export const WITHDRAWAL_STATUS: Record<string, { label: string; tone: PillTone }> = {
  PENDING: { label: "Requested", tone: "warning" },
  APPROVED: { label: "Approved", tone: "accent" },
  COMPLETED: { label: "Paid", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
};

export const withdrawalStatus = (s: string) => WITHDRAWAL_STATUS[s] ?? { label: "Withdrawal", tone: "neutral" as const };

export const OFFLINE_EVENT: Record<string, string> = {
  CLOCK_IN: "Clock-in",
  CLOCK_OUT: "Clock-out",
  BREAK_START: "Break start",
  BREAK_END: "Break end",
};

/** Why an offline tap came to the office, for the person deciding (API_V1.md §6). */
export const OFFLINE_WHY: Record<string, string> = {
  GAP_OVER_LIMIT: "The phone was offline and sent it more than five minutes after the tap.",
  NOT_PROVEN_OFFLINE: "The phone was online in between, so the time it claims couldn't be checked.",
  COULD_NOT_APPLY: "It couldn't be applied as sent, so the office decides.",
};

/** The web's own labels (core JOB_ISSUE_CATEGORY_LABEL), the same words the cleaner picked. */
export const issueCategory = (c: string) => JOB_ISSUE_CATEGORY_LABEL[c as keyof typeof JOB_ISSUE_CATEGORY_LABEL] ?? "Something else";

export const ISSUE_STATUS: Record<string, { label: string; tone: PillTone }> = {
  OPEN: { label: "Open", tone: "danger" },
  ACKNOWLEDGED: { label: "Seen", tone: "warning" },
  RESOLVED: { label: "Resolved", tone: "success" },
};

export const issueStatus = (s: string) => ISSUE_STATUS[s] ?? { label: "Report", tone: "neutral" as const };

/** "Amara D.": a name short enough for a crew line. */
export function shortName(name: string): string {
  const [first, last] = name.split(/\s+/);
  return last ? `${first} ${last[0]}.` : (first ?? name);
}
