import { getCurrentOrg } from "@/lib/org";
import { orgFromContext } from "@/lib/org-context";
import { platformDb } from "@/lib/platform-db";

/**
 * Which number a company texts from, and which company a text came back to.
 *
 * Twilio's inbound webhook tells us the number that received the message and
 * essentially nothing else. That number is therefore the only routing key
 * available, which is why it is unique on the organization.
 */

export interface SmsSender {
  /** E.164 number, when the company sends from a bare number. */
  from?: string;
  /** Messaging Service SID, when it uses one instead. */
  messagingServiceSid?: string;
}

/**
 * The sender for the organization this code is running as.
 *
 * Falls back to the environment when the workspace has no number of its own.
 * That fallback is what keeps the first tenant working unchanged: it has always
 * sent from the configured number, and nothing about it has to move on the day
 * a second tenant arrives.
 */
export async function senderForCurrentOrg(): Promise<SmsSender> {
  const env: SmsSender = {
    from: process.env.TWILIO_FROM_NUMBER || undefined,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || undefined,
  };

  try {
    const ctx = orgFromContext();
    const org = ctx
      ? await platformDb.organization.findUnique({
          where: { id: ctx.id },
          select: { smsNumber: true, smsMessagingServiceSid: true },
        })
      : await getCurrentOrg();

    if (org?.smsMessagingServiceSid) {
      return { messagingServiceSid: org.smsMessagingServiceSid };
    }
    if (org?.smsNumber) {
      return { from: org.smsNumber };
    }
  } catch {
    // No request and no context — fall through to the environment rather than
    // failing the send. A message from the wrong number is recoverable; a
    // reminder that never went out is not.
  }

  return env;
}

/**
 * Which organization a customer was texting, worked out from the number their
 * message arrived on.
 *
 * Returns null when nothing matches, and the caller decides what that means.
 * Deliberately not "guess the default": silently attaching a stranger's text to
 * whichever workspace happens to be first would put one company's customer into
 * another company's chat thread.
 */
export async function orgForInboundNumber(to: string) {
  const number = to.trim();
  if (!number) return null;

  return platformDb.organization.findFirst({
    where: { smsNumber: number, status: "ACTIVE" },
    select: { id: true, slug: true, name: true, timezone: true },
  });
}
