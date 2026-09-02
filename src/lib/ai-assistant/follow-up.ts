// The lead follow-up sequence: the platform's version of the client's two
// scheduled n8n workflows ("VA Lead after 30 days" and "Follow Up"), as one
// engine — minus the part where theirs was secretly still in 7-day test mode.
//
// Each workspace configures quiet-day thresholds in Settings → AI Assistant,
// e.g. [3, 10, 30]: a lead silent 3 days gets touch one, silent 10 days gets
// touch two, silent 30 gets the last call — then the sequence ends and the
// lead flips NEW → CONTACTED, permanently out of the pool. A lead who writes
// back has their count reset (captureLead): re-engaging restarts the clock,
// because "you talked to us yesterday" and "you vanished a month ago" deserve
// different treatment.
//
// Messages are fixed, friendly templates — deterministic and free — and they
// land IN the conversation system, so a reply goes straight to the assistant
// with full context. SMS when we have a phone, email otherwise.
//
// Once a day from the reminders cron. Crash-safe by ordering: the lead's
// counters advance only after a delivery succeeded, so a failed send simply
// retries tomorrow, and a crash between send and update costs at most one
// duplicate message, never a lost lead.
import "server-only";

import { db } from "@/lib/org-db";
import { sendSms } from "@/lib/sms";
import { sendConversationalEmailReply } from "@/lib/email";
import { buildWorkspaceKnowledge } from "./knowledge";

const BATCH = 50;

export interface FollowUpCounts {
  eligible: number;
  sent: number;
  completedSequence: number;
  skippedNoAddress: number;
  failed: number;
}

/**
 * Touch templates, indexed by how many follow-ups the lead already had.
 * Written to escalate gently: check-in → nudge with openings → last call.
 */
function touchMessage(
  touch: number,
  totalTouches: number,
  name: string | null,
  businessName: string,
  bookingUrl: string,
): { text: string; subject: string } {
  const first = name ? ` ${name.split(" ")[0]}` : "";
  const book = bookingUrl ? ` You can see prices and book online here: ${bookingUrl}` : "";
  const isLast = touch >= totalTouches - 1;

  if (touch === 0) {
    return {
      subject: "Still thinking about a cleaning?",
      text: `Hi${first}! It's ${businessName}. You reached out about a cleaning a little while ago and we didn't want to leave you hanging — still interested?${book} Or just reply here and I'll help you out.`,
    };
  }
  if (!isLast) {
    return {
      subject: "We saved you a spot",
      text: `Hi${first}, ${businessName} again. We've got openings this week and next if the timing works better now.${book} Happy to answer any questions — just reply here.`,
    };
  }
  return {
    subject: "Last note from us",
    text: `Hi${first}, it's ${businessName}. We won't keep messaging you — this is our last note. If you ever need a cleaning, we'd love to help.${book} Take care!`,
  };
}

/** Runs inside one org's context (the cron wraps runAsOrg). */
export async function runLeadFollowUps(): Promise<FollowUpCounts> {
  const counts: FollowUpCounts = {
    eligible: 0,
    sent: 0,
    completedSequence: 0,
    skippedNoAddress: 0,
    failed: 0,
  };

  const knowledge = await buildWorkspaceKnowledge();
  const { config, businessName, bookingUrl } = knowledge;
  const sequence = config.followUpSequenceDays;
  if (!config.enabled || sequence.length === 0) return counts;

  // Leave headroom under the daily cap for actual conversations. The cap
  // counts all message rows (see conversation.ts), so compare against ×2.
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const usedToday = await db.aiMessage.count({
    where: { createdAt: { gte: dayStart } },
  });
  const budget = Math.max(0, config.dailyMessageCap - Math.floor(usedToday / 2));
  if (budget === 0) return counts;

  // A lead on touch k is due when quiet for sequence[k] days. The longest
  // threshold bounds the query; exact eligibility is decided per lead.
  const now = Date.now();
  const widestCutoff = new Date(now - sequence[0] * 24 * 60 * 60 * 1000);
  const leads = await db.lead.findMany({
    where: {
      status: "NEW",
      deletedAt: null,
      lastActivityAt: { lte: widestCutoff },
      followUpCount: { lt: sequence.length },
    },
    orderBy: { lastActivityAt: "asc" },
    take: Math.min(BATCH, budget),
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      followUpCount: true,
      lastActivityAt: true,
    },
  });

  for (const lead of leads) {
    try {
      const touch = Math.min(lead.followUpCount, sequence.length - 1);
      const quietDays = (now - lead.lastActivityAt.getTime()) / (24 * 60 * 60 * 1000);
      if (quietDays < sequence[touch]) continue; // not this touch's turn yet
      counts.eligible++;

      const phone = lead.phone?.trim() || null;
      const email = lead.email?.trim() || null;
      const channel = phone ? ("SMS" as const) : email ? ("EMAIL" as const) : null;
      if (!channel) {
        counts.skippedNoAddress++;
        // Unreachable forever — retire it from the pool rather than rescanning daily.
        await db.lead.update({
          where: { id: lead.id },
          data: { status: "CONTACTED" },
        });
        continue;
      }
      const address = channel === "SMS" ? phone! : email!.toLowerCase();
      const msg = touchMessage(touch, sequence.length, lead.name, businessName, bookingUrl);

      const delivered =
        channel === "SMS"
          ? (await sendSms({ to: address, body: msg.text })).sent
          : await sendConversationalEmailReply({
              to: address,
              subject: msg.subject,
              text: msg.text,
            });
      if (!delivered) {
        counts.failed++;
        continue; // counters untouched — this touch retries tomorrow
      }

      // Record it where a reply will land, so the assistant has the context.
      const cutoff30 = new Date(now - 30 * 24 * 60 * 60 * 1000);
      let convo = await db.aiConversation.findFirst({
        where: { channel, customerAddress: address, lastMessageAt: { gte: cutoff30 } },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true },
      });
      convo ??= await db.aiConversation.create({
        data: { channel, customerAddress: address },
        select: { id: true },
      });
      await db.aiMessage.create({
        data: {
          conversationId: convo.id,
          direction: "OUTBOUND",
          author: "ASSISTANT",
          body: msg.text,
          internalNote: `Automatic follow-up ${touch + 1} of ${sequence.length}: lead quiet ${Math.floor(quietDays)} days.`,
        },
      });
      await db.aiConversation.update({
        where: { id: convo.id },
        data: { lastMessageAt: new Date() },
      });

      const sequenceDone = touch + 1 >= sequence.length;
      await db.lead.update({
        where: { id: lead.id },
        data: {
          followUpCount: touch + 1,
          lastFollowUpAt: new Date(),
          // NOTE: lastActivityAt is deliberately NOT bumped — it means THEIR
          // activity. Bumping it here would push every later touch out by the
          // gap between touches.
          ...(sequenceDone ? { status: "CONTACTED" as const } : {}),
        },
      });
      counts.sent++;
      if (sequenceDone) counts.completedSequence++;
    } catch (e) {
      console.error(`[ai-assistant] follow-up failed for lead ${lead.id}`, e);
      counts.failed++;
    }
  }

  return counts;
}
