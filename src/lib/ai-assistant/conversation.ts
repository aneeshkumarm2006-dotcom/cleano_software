// Orchestration: one inbound customer message, start to finish.
//
// The SMS webhook and (later) the email webhook both funnel here; they differ
// only in the `deliver` callback that actually sends the reply. Everything
// else — threading, the daily cap, the model call, recording both sides,
// waking the team on a handoff — is channel-agnostic and lives in one place.
//
// Runs inside org context (the callers wrap runAsOrg), so `db` is scoped and
// getSetting reads the right workspace.
import "server-only";

import type { AiChannel } from "@prisma/client";
import { db } from "@/lib/org-db";
import { sendAdminAiHandoff } from "@/lib/email";
import { buildWorkspaceKnowledge } from "./knowledge";
import { generateAssistantReply } from "./respond";
import type { ChatTurn } from "./claude";

/**
 * A quiet gap after which a text from the same number is a NEW conversation,
 * not a continuation. Mirrors the job-chat rethreading window: past a month,
 * "hi, do you clean offices?" has nothing to do with last spring's booking.
 */
const RETHREAD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** How much history the model sees. Enough for context, bounded for cost. */
const MAX_TURNS = 20;

/** Handoff EMAILS per workspace per day; the conversations list is unlimited. */
const HANDOFF_EMAILS_PER_DAY = 20;

/**
 * A prospect who texts or emails the business is a Lead. New conversation →
 * find-or-create (deduped by the address, and never shadowing an existing
 * lead); continuing conversation → bump lastActivityAt so the 30-day
 * follow-up doesn't nag someone who is actively talking to us.
 *
 * SMS prospects have no email, and Lead.email is required — the empty string
 * is used deliberately there (matching how imports handle it), with the phone
 * carrying the identity.
 */
async function captureLead(
  channel: AiChannel,
  address: string,
  isNewConversation: boolean,
): Promise<void> {
  const identity =
    channel === "EMAIL" ? { email: address } : { phone: address };
  const existing = await db.lead.findFirst({
    where: { ...identity, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    // They wrote back: bump their activity AND rewind the follow-up sequence.
    // Re-engagement restarts the clock — going quiet again after a real
    // conversation earns a fresh gentle check-in, not "touch 3 of 3, last
    // call". Status is left alone on purpose: a CONTACTED lead (sequence
    // finished, or an admin working them) talks to the assistant like anyone
    // else but is never pulled back into the automatic pool.
    await db.lead.update({
      where: { id: existing.id },
      data: { lastActivityAt: new Date(), followUpCount: 0 },
    });
    return;
  }
  if (!isNewConversation) return;
  await db.lead.create({
    data: {
      email: channel === "EMAIL" ? address : "",
      phone: channel === "SMS" ? address : null,
      source: "ai-assistant",
    },
  });
}

export interface InboundResult {
  conversationId: string;
  /** What was sent back, if anything. */
  replied: boolean;
}

/**
 * Record an inbound customer message and, when the assistant is allowed to,
 * answer it. Callers have ALREADY checked the workspace config (enabled +
 * channel toggle) — this keeps the config read next to the webhook's early
 * exits, where its absence is easiest to notice.
 *
 * Never throws: a failure here must not turn into a webhook 500 that makes
 * Twilio retry-storm the workspace.
 */
export async function handleInboundAiMessage(opts: {
  channel: AiChannel;
  /** E.164 phone (SMS) or lowercased email address (EMAIL). */
  address: string;
  /** Matched client, when there is one. Prospects are null — and welcome. */
  clientId: string | null;
  clientName: string | null;
  text: string;
  dailyMessageCap: number;
  /** Send `body` to the customer on this channel. Resolves true if sent. */
  deliver: (body: string) => Promise<boolean>;
}): Promise<InboundResult | null> {
  try {
    // ── Thread it ──────────────────────────────────────────────────────────
    const cutoff = new Date(Date.now() - RETHREAD_WINDOW_MS);
    let convo = await db.aiConversation.findFirst({
      where: {
        channel: opts.channel,
        customerAddress: opts.address,
        lastMessageAt: { gte: cutoff },
      },
      orderBy: { lastMessageAt: "desc" },
    });
    let isNewConversation = false;
    if (!convo) {
      isNewConversation = true;
      convo = await db.aiConversation.create({
        data: {
          channel: opts.channel,
          customerAddress: opts.address,
          clientId: opts.clientId,
        },
      });
    }

    // A stranger starting a conversation IS a lead — capture it so the
    // follow-up automations can see them. Best effort, never blocks the reply.
    if (!opts.clientId) {
      await captureLead(opts.channel, opts.address, isNewConversation).catch(() => {});
    }

    await db.aiMessage.create({
      data: {
        conversationId: convo.id,
        direction: "INBOUND",
        author: "CUSTOMER",
        body: opts.text,
      },
    });
    await db.aiConversation.update({
      where: { id: convo.id },
      data: {
        lastMessageAt: new Date(),
        // A conversation that started before this person became a client can
        // pick the link up now.
        ...(opts.clientId && !convo.clientId ? { clientId: opts.clientId } : {}),
      },
    });

    const customerLabel = opts.clientName ?? opts.address;
    const escalate = async (reason: string) => {
      // Notify only on the TRANSITION into needing a human — a customer
      // sending five follow-up texts is one problem, not five emails. The
      // flip is atomic (updateMany with the old state in the WHERE) so two
      // rapid messages can't both win the transition and double-email.
      const flipped = await db.aiConversation.updateMany({
        where: { id: convo.id, needsHuman: false },
        data: { needsHuman: true },
      });
      if (flipped.count !== 1) return;

      // The handoff email has its own daily budget. Without one, an attacker
      // who exhausts (or bypasses) the reply cap turns every further message
      // into admins.length emails — and the real handoffs drown in the noise.
      // Past the budget the conversation still flips needsHuman and still
      // sorts to the top of /admin/conversations; only the email stops.
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const handoffsToday = await db.emailLog.count({
        where: { notificationKey: "admin.ai.handoff", createdAt: { gte: dayStart } },
      });
      if (handoffsToday >= HANDOFF_EMAILS_PER_DAY) return;
      await db.emailLog.create({
        data: {
          kind: "OTHER",
          recipient: "workspace admins",
          subject: `AI handoff — ${customerLabel}`.slice(0, 200),
          status: "SENT",
          notificationKey: "admin.ai.handoff",
        },
      });

      await sendAdminAiHandoff({
        conversationId: convo.id,
        channelLabel: opts.channel === "SMS" ? "Text message" : "Email",
        customerLabel,
        lastMessage: opts.text,
        reason,
      });
    };

    // ── May the assistant speak? ───────────────────────────────────────────
    if (!convo.aiEnabled) {
      // A human owns this thread. Record + surface, never talk over them.
      await escalate("A teammate has taken over this conversation; the customer just wrote again.");
      return { conversationId: convo.id, replied: false };
    }

    // The budget counts EVERY message row today, not just delivered replies.
    // Counting only assistant sends left a hole: a message engineered to make
    // the model return nothing parseable (or to fail delivery) still paid for
    // a full model call while never incrementing the counter — unmetered API
    // spend. Inbound rows are written before the model is consulted, so they
    // are the honest proxy for invocations; a normal exchange is two rows,
    // hence the ×2.
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const usedToday = await db.aiMessage.count({
      where: { createdAt: { gte: dayStart } },
    });
    if (usedToday >= opts.dailyMessageCap * 2) {
      await escalate(
        `The assistant reached its daily limit of ${opts.dailyMessageCap} messages and stayed quiet.`,
      );
      return { conversationId: convo.id, replied: false };
    }

    // ── Ask the model ──────────────────────────────────────────────────────
    const history = await db.aiMessage.findMany({
      where: { conversationId: convo.id },
      orderBy: { createdAt: "desc" },
      take: MAX_TURNS,
      select: { author: true, body: true },
    });
    const turns: ChatTurn[] = history
      .reverse()
      .map((m) => ({
        role: m.author === "CUSTOMER" ? ("user" as const) : ("assistant" as const),
        content: m.body,
      }));

    const knowledge = await buildWorkspaceKnowledge();
    const verdict = await generateAssistantReply({
      knowledge,
      channel: opts.channel,
      turns,
    });

    // ── Deliver + record ───────────────────────────────────────────────────
    let replied = false;
    if (verdict.reply) {
      replied = await opts.deliver(verdict.reply).catch(() => false);
      if (replied) {
        await db.aiMessage.create({
          data: {
            conversationId: convo.id,
            direction: "OUTBOUND",
            author: "ASSISTANT",
            body: verdict.reply,
            internalNote: verdict.reason,
          },
        });
        await db.aiConversation.update({
          where: { id: convo.id },
          data: { lastMessageAt: new Date() },
        });
      }
    }

    if (verdict.handoff || !replied) {
      await escalate(verdict.reason);
    }

    return { conversationId: convo.id, replied };
  } catch (err) {
    console.error("[ai-assistant] handleInboundAiMessage failed:", err);
    return null;
  }
}
