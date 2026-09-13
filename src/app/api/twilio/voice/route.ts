import { NextRequest } from "next/server";
import { runAsOrg } from "@/lib/org-context";
import { inboundNumberMatch } from "@/lib/sms-sender";
import { logActivity } from "@/lib/activity-log";
import { twilioForOrgId } from "@/lib/twilio-org";
import { isValidTwilioSignature } from "@/lib/twilio-signature";
import {
  MASKED_CALL_UNAVAILABLE,
  maskedDialTwiml,
  maskedSayTwiml,
  resolveMaskedRoute,
} from "@/lib/phone-masking";

// The voice leg of phone masking. Twilio POSTs here (form-encoded) when someone
// dials one of a workspace's `ProxyNumber`s, and we bridge the call to whoever
// the other half of that pairing is — so a cleaner and a customer can speak
// without either one ever holding the other's mobile number.
//
// Same order of operations as the inbound SMS webhook next door, for the same
// reason: the number that was DIALLED is the only routing key Twilio gives us,
// and a workspace on its own Twilio account signs with THEIR auth token, so the
// organization has to be identified before there is a token to verify against.
//
// Twilio setup: point the number's "A call comes in" webhook (HTTP POST) at
//   https://<your-domain>/api/twilio/voice
// Optionally set TWILIO_WEBHOOK_BASE_URL to the exact public origin Twilio is
// configured with, if the auto-detected origin ever mismatches behind proxies.

export const runtime = "nodejs";

function twiml(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

/** Enough of a number to recognise a caller in the log, and no more. */
function last4(number: string): string {
  return number.length > 4 ? `…${number.slice(-4)}` : "…";
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = typeof v === "string" ? v : "";

  // NO RATE LIMITER, matching the inbound SMS webhook, which has none either.
  // The signature check below is the gate: an unsigned request does no work and
  // touches no tenant data, and a signed one could only be produced by whoever
  // holds this workspace's Twilio auth token. A limiter here would instead
  // start dropping real calls during a busy morning.

  // Resolved BEFORE verification, deliberately — see the long note in
  // ../inbound/route.ts. `To` is only a key into our own table of numbers we
  // serve, nothing is written, and the request is still refused below unless it
  // verifies against this workspace's own credentials.
  const match = await inboundNumberMatch(params.To ?? "");
  // Not a number we serve, or the receptionist's line rather than a masked one.
  // The receptionist number has no voice behaviour, and answering a call on it
  // with somebody's masked pairing would be the worst possible way to be wrong.
  if (!match || match.kind !== "proxy") {
    return twiml(maskedSayTwiml(MASKED_CALL_UNAVAILABLE));
  }
  const org = match.org;

  const resolved = await twilioForOrgId(org.id);
  if (!resolved.ok) return twiml(maskedSayTwiml(MASKED_CALL_UNAVAILABLE));

  // Reconstruct the exact URL Twilio signed.
  const base =
    process.env.TWILIO_WEBHOOK_BASE_URL ??
    `${req.headers.get("x-forwarded-proto") ?? "https"}://${req.headers.get("host") ?? ""}`;
  const url = `${base}/api/twilio/voice`;

  const signature = req.headers.get("x-twilio-signature");
  if (!isValidTwilioSignature(url, params, signature, resolved.creds.authToken)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const proxyNumber = params.To ?? "";
  const from = params.From ?? "";

  return runAsOrg(org, async () => {
    const route = await resolveMaskedRoute(proxyNumber, from);

    // Logged the way sendSms logs a text, under the same category: the relayed
    // texts land there too, and an admin asking "did masked contact work for
    // this job?" should not have to read two places. `targetId` is the COMPANY
    // number — neither participant's real number goes into the row, and the
    // caller appears only as its last four digits.
    await logActivity({
      category: "SMS",
      action: "masked_call",
      status: route.ok ? "SUCCESS" : "FAILED",
      targetType: "phone",
      targetId: proxyNumber,
      message: route.ok
        ? `A call to ${proxyNumber} was connected (${route.direction}).`
        : `A call to ${proxyNumber} from ${last4(from)} could not be connected.`,
      error: route.ok ? null : route.reason,
    });

    // Always 200 with TwiML: a non-2xx makes Twilio play its own error message
    // to a caller who did nothing wrong, and then retry.
    if (!route.ok) return twiml(maskedSayTwiml(MASKED_CALL_UNAVAILABLE));

    // `callerId` is the proxy number, so the person answering sees the company
    // number they already know — never the caller's real one.
    return twiml(maskedDialTwiml(route.contact.proxyNumber, route.to));
  });
}
