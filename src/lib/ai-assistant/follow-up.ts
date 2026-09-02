// The quiet-lead follow-up: the platform's version of the client's
// "VA Lead after 30 days" workflow, minus the part where it was secretly
// still in 7-day test mode.
//
// Once a day (the reminders cron), each workspace with the assistant on and a
// follow-up window configured messages every lead that has been quiet for that
// many days: SMS if we have a phone, email otherwise. The message is a fixed,
// friendly template — deterministic and free — and it lands IN the
// conversation system, so when the lead replies the assistant picks the
// thread up with full context.
//
// Idempotency is the status flip: only NEW leads are followed up, and a sent
// follow-up marks the lead CONTACTED. One follow-up per lead, ever — a second
// nudge to someone who ignored the first is where "helpful" becomes "spam".
import "server-only";

import { db } from "@/lib/org-db";
import { sendSms } from "@/lib/sms";
import { sendConversationalEmailReply } from "@/lib/email";
import { buildWorkspaceKnowledge } from "./knowledge";

const BATCH = 50;

export interface FollowUpCounts {
  eligible: number;
  sent: number;
  skippedNoAddress: number;
  failed: number;
}

/** Runs inside one org's context (the cron wraps runAsOrg). */
export async function runLeadFollowUps(): Promise<FollowUpCounts> {
  const counts: FollowUpCounts = { eligible: 0, sent: 0, skippedNoAddress: 0, failed: 0 };

  const knowledge = await buildWorkspaceKnowledge();
  const { config, businessName, bookingUrl } = knowledge;
  if (!config.enabled || config.leadFollowUpDays <= 0) return counts;

  // Leave headroom under the daily cap for actual conversations.
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const sentToday = await db.aiMessage.count({
    where: { author: "ASSISTANT", createdAt: { gte: dayStart } },
  });
  const budget = Math.max(0, Math.floor(config.dailyMessageCap / 2) - sentToday);
  if (budget === 0) return counts;

  const cutoff = new Date(Date.now() - config.leadFollowUpDays * 24 * 60 * 60 * 1000);
  const leads = await db.lead.findMany({
    where: {
      status: "NEW",
      deletedAt: null,
      lastActivityAt: { lte: cutoff },
    },
    orderBy: { lastActivityAt: "asc" },
    take: Math.min(BATCH, budget),
    select: { id: true, name: true, email: true, phone: true },
  });
  counts.eligible = leads.length;

  const message = (name: string | null) =>
    [
      `Hi${name ? ` ${name.split(" ")[0]}` : ""}! It's ${businessName}.`,
      `You reached out about a cleaning a little while ago and we didn't want to leave you hanging — still interested?`,
      bookingUrl ? `You can see prices and book online here: ${bookingUrl}` : "",
      `Or just reply here and I'll help you out.`,
    ]
      .filter(Boolean)
      .join(" ");

  for (const lead of leads) {
    try {
      const phone = lead.phone?.trim() || null;
      const email = lead.email?.trim() || null;
      const channel = phone ? ("SMS" as const) : email ? ("EMAIL" as const) : null;
      if (!channel) {
        counts.skippedNoAddress++;
        continue;
      }
      const address = channel === "SMS" ? phone! : email!.toLowerCase();
      const text = message(lead.name);

      const delivered =
        channel === "SMS"
          ? (await sendSms({ to: address, body: text })).sent
          : await sendConversationalEmailReply({
              to: address,
              subject: `Still thinking about a cleaning?`,
              text,
            });
      if (!delivered) {
        counts.failed++;
        continue;
      }

      // Record it where a reply will land, so the assistant has the context.
      const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
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
          body: text,
          internalNote: `Automatic follow-up: lead quiet for ${config.leadFollowUpDays}+ days.`,
        },
      });
      await db.aiConversation.update({
        where: { id: convo.id },
        data: { lastMessageAt: new Date() },
      });

      // The dedupe: NEW → CONTACTED means this lead is never followed up again.
      await db.lead.update({
        where: { id: lead.id },
        data: { status: "CONTACTED", lastActivityAt: new Date() },
      });
      counts.sent++;
    } catch (e) {
      console.error(`[ai-assistant] follow-up failed for lead ${lead.id}`, e);
      counts.failed++;
    }
  }

  return counts;
}
