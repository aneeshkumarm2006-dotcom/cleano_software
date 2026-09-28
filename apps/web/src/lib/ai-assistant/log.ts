// What the AI assistant tells the admin panel.
//
// Until this existed, every assistant failure went to console.error — visible
// to a developer in Vercel, invisible to the person whose customers were being
// ignored. An admin could open Settings → Logs, see nothing wrong, and never
// learn the assistant had stopped answering. These helpers put those events
// where that admin already looks, in the same shape as every other log row.
//
// Rules kept deliberately narrow:
//   - Plain English. The row is read by a cleaning-company owner, not by us.
//   - Never the customer's message body. The transcript lives in the
//     conversation; the log says what HAPPENED, not what was said.
//   - Never throws (logActivity swallows its own errors), so logging can never
//     break the reply it is recording.
import "server-only";

import { logActivity } from "@/lib/activity-log";

/** Who the event was about, shown as the log row's target. */
interface Who {
  conversationId?: string | null;
  address?: string | null;
}

function target(who: Who) {
  return {
    targetType: who.conversationId ? "aiConversation" : null,
    targetId: who.conversationId ?? null,
  };
}

/** The assistant answered a customer. */
export async function logAiReplied(who: Who, channel: "SMS" | "EMAIL", note: string) {
  await logActivity({
    category: "AI",
    action: "ai.replied",
    status: "SUCCESS",
    ...target(who),
    message: `Assistant answered ${who.address ?? "a customer"} by ${
      channel === "SMS" ? "text" : "email"
    }. ${note}`,
  });
}

/**
 * The assistant stepped back and a person is needed. SKIPPED, not FAILED:
 * nothing went wrong — handing off is the assistant working correctly — but it
 * still needs to be visible, because a customer is waiting.
 */
export async function logAiHandoff(who: Who, reason: string) {
  await logActivity({
    category: "AI",
    action: "ai.handoff",
    status: "SKIPPED",
    ...target(who),
    message: `Handed to your team: ${reason}`,
  });
}

/** The assistant could not answer at all. This is the row that matters. */
export async function logAiFailed(who: Who, what: string, error?: string | null) {
  await logActivity({
    category: "AI",
    action: "ai.failed",
    status: "FAILED",
    ...target(who),
    message: what,
    error: error ?? null,
  });
}

/** One daily follow-up run, summarised. */
export async function logAiFollowUpRun(counts: {
  eligible: number;
  sent: number;
  completedSequence: number;
  retiredAsClient: number;
  skippedNoAddress: number;
  failed: number;
}) {
  const parts = [`${counts.sent} sent of ${counts.eligible} due`];
  if (counts.completedSequence > 0) parts.push(`${counts.completedSequence} finished the sequence`);
  if (counts.retiredAsClient > 0) parts.push(`${counts.retiredAsClient} had already booked`);
  if (counts.skippedNoAddress > 0) parts.push(`${counts.skippedNoAddress} had no phone or email`);
  if (counts.failed > 0) parts.push(`${counts.failed} failed to send`);

  await logActivity({
    category: "AI",
    action: "ai.follow_ups",
    // A partial failure is still a failure worth a red badge: those customers
    // did not get their message, and nobody would otherwise know.
    status: counts.failed > 0 ? "FAILED" : "SUCCESS",
    message: `Lead follow-ups: ${parts.join(", ")}.`,
    error: counts.failed > 0 ? `${counts.failed} message(s) could not be delivered` : null,
  });
}

/** Inbound mail refused before it reached the assistant. */
export async function logAiInboundRejected(address: string, why: string) {
  await logActivity({
    category: "AI",
    action: "ai.inbound_rejected",
    status: "SKIPPED",
    message: `Ignored an email from ${address}: ${why}`,
  });
}
