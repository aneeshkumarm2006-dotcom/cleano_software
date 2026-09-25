// The shape a conversation is drawn from, whichever conversation it is.
//
// Office chat and team chat come from different endpoints with slightly
// different messages; both are turned into ThreadMessages here so one list,
// one bubble and one composer serve both.
import type { MessageAttachment } from "@bookmops/api/v1";

import { localDateKey, shortDate } from "@/lib/format";

import type { PendingMessage } from "./pending";

export type MessageStatus = "sending" | "failed" | "sent" | "delivered" | "read";

export interface ThreadMessage {
  key: string;
  mine: boolean;
  /** Stable per sender, to tell one person's run of messages from the next. */
  senderKey: string;
  senderName: string;
  body: string;
  createdAt: string;
  attachment: MessageAttachment | null;
  /** On the person's own messages only. */
  status: MessageStatus | null;
  /** For a failed message: the id to retry or discard it by, and why. */
  pendingId?: string;
  error?: string | null;
  /** The server's id, on a message the person may edit or delete. */
  editableId?: string;
  /** The server's id, on someone else's message the office may remove (team chat moderation). */
  removableId?: string;
  /** When it was last edited, or null. */
  editedAt?: string | null;
  /** Deleted: shown as "Message deleted", with no body. */
  deleted?: boolean;
}

export type ThreadRow =
  | { type: "message"; key: string; message: ThreadMessage; showName: boolean }
  | { type: "day"; key: string; label: string };

export function pendingToMessage(p: PendingMessage, me: { id: string; name: string }): ThreadMessage {
  return {
    key: `pending-${p.id}`,
    mine: true,
    senderKey: me.id,
    senderName: me.name,
    body: p.body,
    createdAt: new Date(p.createdAt).toISOString(),
    attachment: null,
    status: p.status,
    pendingId: p.id,
    error: p.error,
  };
}

/** "Today", "Yesterday", or "Tue 22 Sep" — by the company's calendar. */
export function dayLabel(iso: string, timeZone: string, now: Date): string {
  const day = localDateKey(iso, timeZone);
  const today = localDateKey(now.toISOString(), timeZone);
  // Both are YYYY-MM-DD, so their difference as UTC dates is whole days.
  const diff = Math.round((Date.parse(today) - Date.parse(day)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return shortDate(iso, timeZone);
}

/**
 * Rows for an INVERTED list: newest first, with a day marker after the last
 * (oldest) message of each day, which an inverted list draws above it.
 */
export function buildRows(
  newestFirst: readonly ThreadMessage[],
  timeZone: string,
  now: Date,
  showSenderNames: boolean,
): ThreadRow[] {
  const rows: ThreadRow[] = [];
  for (let i = 0; i < newestFirst.length; i++) {
    const m = newestFirst[i]!;
    const older = newestFirst[i + 1];
    const day = localDateKey(m.createdAt, timeZone);
    const newDay = !older || localDateKey(older.createdAt, timeZone) !== day;
    // A name heads each run of messages from one person, as in the design.
    const showName = showSenderNames && !m.mine && (newDay || older.senderKey !== m.senderKey);
    rows.push({ type: "message", key: m.key, message: m, showName });
    if (newDay) rows.push({ type: "day", key: `day-${day}`, label: dayLabel(m.createdAt, timeZone, now) });
  }
  return rows;
}

/**
 * An attachment URL the app will open: https only. The server only returns
 * URLs from its own storage, but a link is opened by the phone, so the phone
 * checks too — never a javascript:, file: or plain-http link.
 */
export function safeHttpsUrl(url: string): string | null {
  return /^https:\/\/[^\s/?#]+[^\s]*$/i.test(url) ? url : null;
}
