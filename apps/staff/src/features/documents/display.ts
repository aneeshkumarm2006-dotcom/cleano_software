import type { DocumentSummary } from "@bookmops/api/v1";

import type { Tone } from "@/features/record/ui";
import { dayMonth, daysBetweenKeys } from "@/lib/dates";
import { localDateKey } from "@/lib/format";

export const STATUS_TAG: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: "To sign", tone: "warn" },
  SIGNED: { label: "Signed", tone: "ok" },
  EXPIRED: { label: "Expired", tone: "neutral" },
  REVOKED: { label: "Withdrawn", tone: "neutral" },
};

export const statusTag = (status: string) => STATUS_TAG[status] ?? { label: "Document", tone: "neutral" as const };

/** "Due 30 Sep", "Due today", "Overdue since 22 Sep", with how urgent it is. */
export function dueLine(doc: DocumentSummary, now: Date, timeZone: string): { text: string; tone: "danger" | "warning" | "ink2" } | null {
  if (doc.status !== "PENDING" || !doc.dueAt) return null;
  const days = daysBetweenKeys(localDateKey(now.toISOString(), timeZone), localDateKey(doc.dueAt, timeZone));
  if (days < 0) return { text: `Overdue since ${dayMonth(doc.dueAt, timeZone)}`, tone: "danger" };
  if (days === 0) return { text: "Due today", tone: "warning" };
  return { text: `Due ${dayMonth(doc.dueAt, timeZone)}`, tone: days <= 3 ? "warning" : "ink2" };
}
