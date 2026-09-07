// Send an inbound text on to a second system, so a workspace can move onto
// Awer without switching anything off on the day it moves.
//
// Twilio allows exactly ONE inbound URL per number or Messaging Service, so
// "keep HubSpot fed while we take over the texting" cannot be configured in
// Twilio at all. It has to be a fan-out somewhere, and the only place that can
// see the message and knows which workspace it belongs to is here.
//
// Signed with the workspace's OWN Twilio auth token, over the destination URL,
// exactly as Twilio would have signed it. That is not a forgery: it is the
// account holder relaying their own account's webhook, at their instruction,
// with their own credentials. Anything less and the receiving system rejects
// every relayed message as unverified, which is the failure mode we are here
// to prevent.
import "server-only";

import { twilioSignature } from "@/lib/twilio-signature";
import { getSetting } from "@/lib/settings";
import { logActivity } from "@/lib/activity-log";

export const SMS_FORWARD_URL_KEY = "sms.forwardInboundUrl";

/**
 * Relay one inbound text to the workspace's configured second system.
 *
 * Runs inside org context, from after(), so it never delays the reply to
 * Twilio and never turns a downstream outage into a retry storm on us. Never
 * throws: the message is already safely stored on our side before this runs,
 * and a failed relay must not undo that.
 */
export async function forwardInboundText(
  params: Record<string, string>,
  authToken: string,
): Promise<void> {
  let url = "";
  try {
    url = await getSetting(SMS_FORWARD_URL_KEY);
  } catch {
    return;
  }
  if (!url) return;

  const body = new URLSearchParams(params).toString();
  let status = 0;
  let problem: string | null = null;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Twilio-Signature": twilioSignature(url, params, authToken),
        "User-Agent": "Awer-SMS-Relay/1",
      },
      body,
      // A permitted hostname that redirects to an internal address would walk
      // straight past the validator, so refuse to be redirected at all.
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    if (status >= 300 && status < 400) problem = "it answered with a redirect, which is not followed";
    else if (!res.ok) problem = `it answered ${status}`;
  } catch (e) {
    problem = e instanceof Error && e.name === "TimeoutError" ? "it did not answer in time" : "it could not be reached";
  }

  if (!problem) return;

  // Only failures are recorded. A row per delivered text would bury the ones
  // that matter under thousands that worked.
  await logActivity({
    category: "WEBHOOK",
    action: "sms.forward.failed",
    status: "FAILED",
    // The destination and the sender, never the customer's words: this row is
    // read to fix a connection, not to reread private messages.
    message: `A text from ${params.From ?? "an unknown number"} reached us but could not be passed on to ${url}.`,
    error: `The other system was contacted and ${problem}. The message is safe here; only the copy failed.`,
  }).catch(() => {});
}
