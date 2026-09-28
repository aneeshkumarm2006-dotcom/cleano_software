// The push notifications Bookmops Pro receives, one function per event.
//
// Each returns an Effect (server/effects.ts): a service puts it in its Result
// and the front door flushes it after the commit (a web action at once, v1
// with after()), and a replayed request never runs it. Web actions that are
// not services yet fire them with fireEffects, next to the emails and alerts
// they already send.
//
// WHAT A PUSH SAYS. A lock screen is public: a first name, a job's area (the
// city, never the street), a date and time, and amounts only for the
// recipient's own pay. Never a client's name, an address, a message's text or
// a problem's description: those are one tap away, behind sign-in.
//
// WHO GETS ONE. Only people of this company (the org-scoped client), active,
// never the person who did the thing. The company's Settings → Notifications
// switch for the event's APP_PUSH channel is respected where the catalog has
// one; events the catalog has no push row for are always on. A job's own
// "notify provider" switch is respected for job events.
import "server-only";

import type { ManagerCapability } from "@bookmops/api/v1";

import { isNotificationEnabled, NOTIFICATION_CATALOG, type Recipient } from "@/lib/notifications";
import { db } from "@/lib/org-db";
import { fmtDate, fmtTime } from "@/lib/time";

import { effect, type Effect } from "../effects";
import { jobArea } from "../jobs/area";
import { deliver, firstName, officeRecipients, pushTeamChat, type PushDeps, type PushNotice } from "./core";
import { pushDeps } from "./deps";

const STAFF_ROLES = ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD", "EMPLOYEE"] as const;
const OFFICE_ROLES = ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD"] as const;

const HAS_PUSH_ROW = new Set(
  NOTIFICATION_CATALOG.filter((e) => "APP_PUSH" in e.channels).map((e) => `${e.recipient}::${e.key}`),
);

/** The company's switch for this event's push, when the catalog has one; otherwise on. */
async function pushAllowed(recipient: Recipient, key: string): Promise<boolean> {
  if (!HAS_PUSH_ROW.has(`${recipient}::${key}`)) return true;
  return isNotificationEnabled(recipient, key, "APP_PUSH");
}

/** An effect that never throws: a failed lookup is logged by name and dropped. */
function pushEffect(label: string, run: (deps: PushDeps) => Promise<unknown>): Effect {
  return effect(`push: ${label}`, async () => {
    const deps = pushDeps();
    try {
      await run(deps);
    } catch (err) {
      deps.log("push.effect_failed", { label, error: err instanceof Error ? err.name : "unknown" });
    }
  });
}

// ── Jobs ────────────────────────────────────────────────────────────────────

interface JobFacts {
  id: string;
  where: string;
  when: string;
  day: string;
  notifyProvider: boolean;
  open: boolean;
}

async function jobFacts(jobId: string): Promise<JobFacts | null> {
  const job = await db.job.findFirst({
    where: { id: jobId },
    select: {
      id: true,
      startTime: true,
      location: true,
      status: true,
      deletedAt: true,
      notifyProvider: true,
      clientAddress: { select: { city: true } },
    },
  });
  if (!job) return null;
  const area = jobArea(job);
  return {
    id: job.id,
    where: area ? `in ${area}` : "",
    when: `${fmtDate(job.startTime)} at ${fmtTime(job.startTime)}`,
    day: fmtDate(job.startTime),
    notifyProvider: job.notifyProvider,
    open: !job.deletedAt && job.status !== "CANCELLED",
  };
}

const jobPhrase = (j: JobFacts) => (j.where ? `The job ${j.where}` : "The job");

export type JobEvent = "offered" | "last_minute" | "assigned" | "unassigned" | "time_changed" | "cancelled";

const JOB_EVENT_KEY: Record<JobEvent, string> = {
  offered: "prov.unassigned.new",
  last_minute: "prov.unassigned.last_minute",
  assigned: "prov.booking.new",
  unassigned: "prov.booking.modified",
  time_changed: "prov.booking.modified",
  cancelled: "prov.cancel.booking_canceled",
};

function jobNotice(event: JobEvent, j: JobFacts): PushNotice {
  switch (event) {
    case "offered":
      return { title: "New job available", body: `A job${j.where ? ` ${j.where}` : ""} on ${j.when} is open to claim.`, path: `/available/${j.id}` };
    case "last_minute":
      return { title: "Job needs a cleaner", body: `A job${j.where ? ` ${j.where}` : ""} on ${j.when} needs someone. Claim it if you can.`, path: `/available/${j.id}` };
    case "assigned":
      return { title: "You've been added to a job", body: `${jobPhrase(j)} on ${j.when} is now yours.`, path: `/jobs/${j.id}` };
    case "unassigned":
      return { title: "Removed from a job", body: `${jobPhrase(j)} on ${j.day} is no longer on your schedule.`, path: "/jobs" };
    case "time_changed":
      return { title: "Job time changed", body: `${jobPhrase(j)} now starts ${j.when}.`, path: `/jobs/${j.id}` };
    case "cancelled":
      return { title: "Job cancelled", body: `${jobPhrase(j)} on ${j.day} was cancelled.`, path: "/jobs" };
  }
}

/**
 * A job event for these cleaners. The job's "notify provider" switch and the
 * company's push setting for the event both apply; `exceptUserId` (whoever
 * made the change) is never pushed.
 */
export function jobPush(event: JobEvent, jobId: string, userIds: readonly string[], exceptUserId?: string | null): Effect {
  const ids = [...userIds];
  return pushEffect(`job ${event}`, async (deps) => {
    const to = ids.filter((id) => id !== exceptUserId);
    if (to.length === 0) return;
    const j = await jobFacts(jobId);
    if (!j || !j.notifyProvider) return;
    // An open job for everything but its cancellation.
    if (event !== "cancelled" && !j.open) return;
    if (!(await pushAllowed("PROVIDER", JOB_EVENT_KEY[event]))) return;
    await deliver(deps, to, jobNotice(event, j));
  });
}

/** The one-hour reminder's text, for the job-reminders cron. */
export function reminderNotice(job: { id: string; startTime: Date; location: string | null; clientAddress?: { city: string | null } | null }): PushNotice {
  const area = jobArea(job);
  return {
    title: "Job in 1 hour",
    body: `Your job ${area ? `in ${area} ` : ""}starts at ${fmtTime(job.startTime)}.`,
    path: `/jobs/${job.id}`,
  };
}

// ── Messages ────────────────────────────────────────────────────────────────

/** The office replied in a cleaner's office chat. */
export function officeReplyPush(cleanerId: string, senderId: string, senderName: string | null): Effect {
  return pushEffect("office reply", async (deps) => {
    if (cleanerId === senderId) return;
    if (!(await pushAllowed("PROVIDER", "prov.chat.new_message_v2"))) return;
    await deliver(deps, [cleanerId], {
      title: "Message from the office",
      body: `${firstName(senderName, "The office")} replied. Tap to read it.`,
      path: "/chat",
    });
  });
}

/** A cleaner wrote to the office: whoever holds the office inbox. */
export function officeChatPush(cleanerId: string, cleanerName: string | null): Effect {
  return pushEffect("office chat", async (deps) => {
    if (!(await pushAllowed("ADMIN", "admin.chat.new_message"))) return;
    const to = officeRecipients(await officePeople(), "OFFICE_INBOX", { creatorId: cleanerId, creatorLeadId: null });
    await deliver(deps, to, {
      title: `Message from ${firstName(cleanerName, "a cleaner")}`,
      body: "New message in the office inbox.",
      path: `/manage/inbox/${cleanerId}`,
    });
  });
}

/**
 * A team chat message: everyone who can see the channel (the default channel
 * is everyone's; any other, its members), never the sender, never someone who
 * blocked the sender, and at most one push per person per channel per two
 * minutes.
 */
export function teamMessagePush(channelId: string, senderId: string, senderName: string | null): Effect {
  return pushEffect("team message", async (deps) => {
    if (!(await pushAllowed("PROVIDER", "prov.chat.new_message"))) return;
    const channel = await db.groupChannel.findFirst({
      where: { id: channelId, isActive: true },
      select: { id: true, name: true, isDefault: true, isDirect: true },
    });
    if (!channel) return;
    const memberIds = channel.isDefault
      ? null
      : (await db.groupChannelMember.findMany({ where: { channelId }, select: { userId: true } })).map((m) => m.userId);
    const people = await db.user.findMany({
      where: {
        role: { in: [...STAFF_ROLES] },
        isActive: true,
        deletedAt: null,
        ...(memberIds ? { id: { in: memberIds } } : {}),
      },
      select: { id: true },
    });
    const blockers = await db.teamChatBlock.findMany({ where: { blockedId: senderId }, select: { blockerId: true } });
    const who = firstName(senderName);
    await pushTeamChat(deps, {
      channelId,
      senderId,
      candidateIds: people.map((p) => p.id),
      blockedSender: new Set(blockers.map((b) => b.blockerId)),
      notice: channel.isDirect
        ? { title: who, body: "Sent you a message.", path: `/team/${channelId}` }
        : { title: channel.name, body: `${who} posted a message.`, path: `/team/${channelId}` },
    });
  });
}

/** A new announcement: every active staff member but its author. */
export function announcementPush(authorId: string | null): Effect {
  return pushEffect("announcement", async (deps) => {
    const people = await db.user.findMany({
      where: { role: { in: [...STAFF_ROLES] }, isActive: true, deletedAt: null },
      select: { id: true },
    });
    await deliver(
      deps,
      people.map((p) => p.id).filter((id) => id !== authorId),
      { title: "New announcement", body: "The office posted an announcement. Tap to read it.", path: "/announcements" },
    );
  });
}

// ── Pay and time ────────────────────────────────────────────────────────────

const money = (dollars: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.round(dollars * 100) / 100);

/** The cleaner's own withdrawal was approved, rejected or paid. Their own amount only. */
export function withdrawalDecidedPush(withdrawalId: string, deciderId: string): Effect {
  return pushEffect("withdrawal decided", async (deps) => {
    const w = await db.withdrawal.findFirst({
      where: { id: withdrawalId },
      select: { employeeId: true, amount: true, status: true },
    });
    if (!w || w.employeeId === deciderId) return;
    const amount = money(w.amount);
    const notice: PushNotice | null =
      w.status === "APPROVED"
        ? { title: "Withdrawal approved", body: `Your withdrawal of ${amount} was approved.`, path: "/pay" }
        : w.status === "REJECTED"
          ? { title: "Withdrawal not approved", body: `Your withdrawal of ${amount} wasn't approved. Tap for details.`, path: "/pay" }
          : w.status === "COMPLETED"
            ? { title: "Withdrawal paid", body: `Your withdrawal of ${amount} has been paid.`, path: "/pay" }
            : null;
    if (!notice) return;
    if (w.status === "COMPLETED" && !(await pushAllowed("PROVIDER", "prov.payout.completed"))) return;
    await deliver(deps, [w.employeeId], notice);
  });
}

/** The cleaner's own time change request was decided. */
export function timeRequestDecidedPush(requestId: string, deciderId: string): Effect {
  return pushEffect("time request decided", async (deps) => {
    const r = await db.timeLogChangeRequest.findFirst({
      where: { id: requestId },
      select: { cleanerId: true, jobId: true, status: true },
    });
    if (!r || r.cleanerId === deciderId) return;
    const j = await jobFacts(r.jobId);
    const on = j?.where ? ` for the job ${j.where}` : "";
    const notice: PushNotice | null =
      r.status === "APPROVED"
        ? { title: "Time change approved", body: `Your time change${on} was approved.`, path: `/jobs/${r.jobId}` }
        : r.status === "REJECTED"
          ? { title: "Time change not approved", body: `Your time change${on} wasn't approved. Tap for the note.`, path: `/jobs/${r.jobId}` }
          : null;
    if (!notice) return;
    await deliver(deps, [r.cleanerId], notice);
  });
}

// ── The office's queue ──────────────────────────────────────────────────────

async function officePeople() {
  return db.user.findMany({
    where: { role: { in: [...OFFICE_ROLES] }, isActive: true, deletedAt: null },
    select: { id: true, role: true },
  });
}

async function leadOf(userId: string): Promise<string | null> {
  const u = await db.user.findFirst({ where: { id: userId }, select: { fieldLeadId: true } });
  return u?.fieldLeadId ?? null;
}

export type ApprovalKind = "time" | "withdrawal" | "kit";

const APPROVAL: Record<ApprovalKind, { capability: ManagerCapability; title: string; body: string; path: (id: string) => string }> = {
  time: { capability: "TIME_APPROVE", title: "Time change to review", body: "asked to correct their hours.", path: (id) => `/manage/time/${id}` },
  withdrawal: { capability: "WITHDRAWALS", title: "Withdrawal to review", body: "requested a withdrawal.", path: (id) => `/manage/withdrawals/${id}` },
  kit: { capability: "KIT_REQUESTS", title: "Kit request to review", body: "asked for kit.", path: () => "/manage/approvals" },
};

/**
 * A new item in the approvals queue, to the people who can decide it: the
 * capability's roles, a Field Lead only for their own group's items, never
 * the person who raised it.
 */
export function approvalPush(kind: ApprovalKind, itemId: string, creatorId: string, creatorName: string | null): Effect {
  return pushEffect(`approval ${kind}`, async (deps) => {
    const a = APPROVAL[kind];
    const to = officeRecipients(await officePeople(), a.capability, { creatorId, creatorLeadId: await leadOf(creatorId) });
    await deliver(deps, to, { title: a.title, body: `${firstName(creatorName, "A cleaner")} ${a.body}`, path: a.path(itemId) });
  });
}

/** An URGENT problem report, to whoever handles issues. */
export function urgentIssuePush(issueId: string, jobId: string, reporterId: string, reporterName: string | null): Effect {
  return pushEffect("urgent issue", async (deps) => {
    const to = officeRecipients(await officePeople(), "ISSUES", { creatorId: reporterId, creatorLeadId: await leadOf(reporterId) });
    if (to.length === 0) return;
    const j = await jobFacts(jobId);
    await deliver(deps, to, {
      title: "Urgent problem reported",
      body: `${firstName(reporterName, "A cleaner")} reported an urgent problem at a job${j?.where ? ` ${j.where}` : ""}.`,
      path: `/manage/issues/${issueId}`,
    });
  });
}
