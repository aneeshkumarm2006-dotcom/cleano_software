// Push notifications to Bookmops Pro, the parts with no database in them.
//
// Everything here takes its sender and its store as arguments (PushDeps), so
// scripts/verify-push.ts runs it against fakes: no network, no database, no
// real phone ever buzzes in a test. The Expo sender is ./expo.ts, the Prisma
// store is ./store.ts, and ./deps.ts puts the real ones together.
//
// The rules:
//   - a push never throws into its caller. It runs as an effect after the
//     commit; a failure is logged (no tokens, no text) and the request, the
//     cron or the next push carry on;
//   - at most EXPO_BATCH_MAX messages per request to Expo;
//   - a transient failure (network, 429, 5xx, MessageRateExceeded) is retried
//     once, then dropped;
//   - DeviceNotRegistered deletes that PushDevice row: the app was removed or
//     the token rotated, and pushing to it again only costs us;
//   - nobody is pushed about their own action, and nobody is pushed a chat
//     message from someone they blocked;
//   - the text carries no personal data beyond a first name and a job's area
//     (never an address), and amounts only for the recipient's own pay. Each
//     notice is written in ./notify.ts with that in mind; `data` carries only
//     the in-app path the app's useNotificationRouting follows.
import { can, type ManagerCapability } from "@bookmops/api/v1";

/** Expo accepts up to 100 messages per request. */
export const EXPO_BATCH_MAX = 100;
/** One push per person per team channel per this long (a burst collapses to one). */
export const CHAT_BURST_WINDOW_MS = 2 * 60_000;
/** How long before a job its reminder goes out, and the slack either side for a 15-minute cron. */
export const REMINDER_LEAD_MS = 60 * 60_000;
const REMINDER_EARLY_MS = 20 * 60_000;
const REMINDER_LATE_MS = 5 * 60_000;
const RETRY_DELAY_MS = 1_000;

export interface PushNotice {
  title: string;
  body: string;
  /** An in-app route, e.g. /jobs/<id>. The app follows nothing else. */
  path?: string;
}

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: { path?: string };
  sound: "default";
  priority: "high";
  /** The Android channel the app creates ("Jobs and messages"). */
  channelId: "default";
}

export type PushTicket =
  | { status: "ok"; id?: string }
  | { status: "error"; message?: string; details?: { error?: string } };

/** A request-level failure. `transient` ones are retried once. */
export class PushSendError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
    this.name = "PushSendError";
  }
}

export interface PushSender {
  /** One request, at most EXPO_BATCH_MAX messages; tickets in message order. Throws PushSendError. */
  send(messages: PushMessage[]): Promise<PushTicket[]>;
}

export interface PushDevice {
  id: string;
  userId: string;
  token: string;
}

export interface PushStore {
  /** This company's devices for these people (active people only). */
  devicesFor(userIds: readonly string[]): Promise<PushDevice[]>;
  /** Delete these rows (DeviceNotRegistered). */
  removeDevices(ids: readonly string[]): Promise<void>;
  /**
   * Of these people, the ones not pushed about `key` within `windowMs`;
   * marks them as pushed now, in the same step.
   */
  claimThrottle(userIds: readonly string[], key: string, windowMs: number, now: Date): Promise<string[]>;
  /** Of these people, the ones whose reminder for this job and start was not yet sent; marks them sent. */
  claimReminder(jobId: string, startTime: Date, userIds: readonly string[]): Promise<string[]>;
}

export interface PushDeps {
  sender: PushSender;
  store: PushStore;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  log: (event: string, detail?: Record<string, unknown>) => void;
}

export interface DeliveryReport {
  devices: number;
  sent: number;
  removed: number;
  failed: number;
}

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_\-]{10,200}\]$/;

export function isExpoPushToken(token: string): boolean {
  return EXPO_TOKEN.test(token);
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Trim to what a lock screen shows; never longer than the field allows. */
function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

export function toMessage(token: string, notice: PushNotice): PushMessage {
  const path = notice.path && notice.path.startsWith("/") && notice.path.length <= 300 ? notice.path : undefined;
  return {
    to: token,
    title: clip(notice.title, 80),
    body: clip(notice.body, 180),
    data: path ? { path } : {},
    sound: "default",
    priority: "high",
    channelId: "default",
  };
}

function errorCode(err: unknown): string {
  if (err instanceof PushSendError) return err.message.slice(0, 80);
  return err instanceof Error ? err.name : "unknown";
}

/** One request, retried once when the failure is transient. Null when it still failed. */
async function sendBatch(deps: PushDeps, messages: PushMessage[]): Promise<PushTicket[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await deps.sender.send(messages);
    } catch (err) {
      const transient = !(err instanceof PushSendError) || err.transient;
      deps.log("push.batch_failed", { attempt, transient, error: errorCode(err), count: messages.length });
      if (!transient || attempt === 1) return null;
      await deps.sleep(RETRY_DELAY_MS);
    }
  }
  return null;
}

function ticketError(t: PushTicket | undefined): string | null {
  if (!t) return "MissingTicket";
  if (t.status === "ok") return null;
  return t.details?.error ?? "Unknown";
}

/**
 * Push one notice to these people's phones in this company. Never throws.
 * Duplicate and empty ids are ignored.
 */
export async function deliver(deps: PushDeps, userIds: readonly string[], notice: PushNotice): Promise<DeliveryReport> {
  const report: DeliveryReport = { devices: 0, sent: 0, removed: 0, failed: 0 };
  try {
    const ids = [...new Set(userIds.filter((id) => typeof id === "string" && id.length > 0))];
    if (ids.length === 0) return report;
    const devices = (await deps.store.devicesFor(ids)).filter((d) => ids.includes(d.userId) && isExpoPushToken(d.token));
    report.devices = devices.length;
    const gone: string[] = [];

    for (const batch of chunk(devices, EXPO_BATCH_MAX)) {
      const messages = batch.map((d) => toMessage(d.token, notice));
      const tickets = await sendBatch(deps, messages);
      if (!tickets) {
        report.failed += batch.length;
        continue;
      }
      const again: number[] = [];
      batch.forEach((device, i) => {
        const code = ticketError(tickets[i]);
        if (code === null) report.sent++;
        else if (code === "DeviceNotRegistered") gone.push(device.id);
        else if (code === "MessageRateExceeded") again.push(i);
        else report.failed++;
      });
      if (again.length > 0) {
        await deps.sleep(RETRY_DELAY_MS);
        const retried = await sendBatch(deps, again.map((i) => messages[i]));
        again.forEach((i, j) => {
          const code = retried ? ticketError(retried[j]) : "RetryFailed";
          if (code === null) report.sent++;
          else if (code === "DeviceNotRegistered") gone.push(batch[i].id);
          else report.failed++;
        });
      }
    }

    if (gone.length > 0) {
      await deps.store.removeDevices(gone);
      report.removed = gone.length;
    }
    if (report.failed > 0 || report.removed > 0) {
      deps.log("push.delivered", { ...report });
    }
  } catch (err) {
    deps.log("push.deliver_failed", { error: errorCode(err) });
  }
  return report;
}

// ── Who is pushed ───────────────────────────────────────────────────────────

/**
 * The people a team chat message is pushed to: those who can see the channel,
 * never the sender, never anyone who blocked the sender.
 */
export function teamChatRecipients(input: {
  candidateIds: readonly string[];
  senderId: string;
  /** People who blocked the sender. */
  blockedSender: ReadonlySet<string>;
}): string[] {
  return [...new Set(input.candidateIds)].filter((id) => id !== input.senderId && !input.blockedSender.has(id));
}

export interface OfficePerson {
  id: string;
  role: string;
}

/**
 * The office people who can act on an item: the role must hold the
 * capability (packages/api/src/v1/manager-access.ts); a FIELD_LEAD only when
 * the person it concerns is in their group; never the person who raised it.
 */
export function officeRecipients(
  people: readonly OfficePerson[],
  capability: ManagerCapability,
  subject: { creatorId: string; creatorLeadId: string | null },
): string[] {
  return people
    .filter((p) => p.id !== subject.creatorId)
    .filter((p) => can(p.role, capability))
    .filter((p) => p.role !== "FIELD_LEAD" || (subject.creatorLeadId !== null && p.id === subject.creatorLeadId))
    .map((p) => p.id);
}

// ── Orchestration the verify script can drive ───────────────────────────────

/** A team chat message: the rule above, then at most one push per person per channel per window. */
export async function pushTeamChat(
  deps: PushDeps,
  input: {
    channelId: string;
    senderId: string;
    candidateIds: readonly string[];
    blockedSender: ReadonlySet<string>;
    notice: PushNotice;
  },
): Promise<DeliveryReport | null> {
  try {
    const to = teamChatRecipients(input);
    if (to.length === 0) return null;
    const fresh = await deps.store.claimThrottle(to, `team:${input.channelId}`, CHAT_BURST_WINDOW_MS, deps.now());
    if (fresh.length === 0) return null;
    return await deliver(deps, fresh, input.notice);
  } catch (err) {
    deps.log("push.team_chat_failed", { error: errorCode(err) });
    return null;
  }
}

/** The start times a reminder run covers: about an hour out, with slack for a 15-minute cron. */
export function reminderWindow(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() + REMINDER_LEAD_MS - REMINDER_EARLY_MS),
    to: new Date(now.getTime() + REMINDER_LEAD_MS + REMINDER_LATE_MS),
  };
}

export interface ReminderJob {
  jobId: string;
  startTime: Date;
  userIds: string[];
  notice: PushNotice;
}

/** Send each job's reminder to the people not yet reminded for this start. Never throws. */
export async function sendJobReminders(deps: PushDeps, jobs: readonly ReminderJob[]): Promise<{ sent: number; people: number }> {
  let sent = 0;
  let people = 0;
  for (const job of jobs) {
    try {
      const claimed = await deps.store.claimReminder(job.jobId, job.startTime, job.userIds);
      if (claimed.length === 0) continue;
      people += claimed.length;
      const r = await deliver(deps, claimed, job.notice);
      sent += r.sent;
    } catch (err) {
      deps.log("push.reminder_failed", { error: errorCode(err) });
    }
  }
  return { sent, people };
}

/** "Anna" from "Anna Marie Smith"; a neutral word when there is no name. */
export function firstName(name: string | null | undefined, fallback = "Someone"): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? clip(first, 30) : fallback;
}
