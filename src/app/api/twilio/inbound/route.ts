import { NextRequest, after } from "next/server";
import { db } from "@/lib/org-db";
import { runAsOrg } from "@/lib/org-context";
import { orgForInboundNumber } from "@/lib/sms-sender";
import { sendSms, toE164 } from "@/lib/sms";
import { isJobChatOpenForClient } from "@/lib/jobChatActions";
import { getAiAssistantConfig } from "@/lib/ai-assistant/knowledge";
import { handleInboundAiMessage } from "@/lib/ai-assistant/conversation";
import { logAiFailed } from "@/lib/ai-assistant/log";
import { twilioForOrgId } from "@/lib/twilio-org";
import { forwardInboundText } from "@/lib/sms-forward";
import { isValidTwilioSignature } from "@/lib/twilio-signature";

// Inbound leg of the job-specific chat SMS bridge (#11). Twilio POSTs here
// (application/x-www-form-urlencoded) when a client texts a company's number.
// We verify the Twilio signature, work out WHICH cleaning company was texted,
// match the sender's phone to one of that company's clients + their active job,
// and append the reply to that job's chat thread as a CLIENT message — so it
// appears in the cleaner/admin app. Returns empty TwiML.
//
// Every company shares this one webhook, so the number the message arrived on
// (Twilio's `To`) is the only thing that says who it was meant for. Matching the
// sender's phone first and asking which company later would be the bug: two
// cleaning companies can easily share a customer, and the same mobile number
// would then land in whichever company's chat happened to be found first.
//
// Twilio setup: point the Messaging Service (or number) "A message comes in"
// webhook (HTTP POST) at  https://<your-domain>/api/twilio/inbound
// Requires TWILIO_AUTH_TOKEN. Optionally set TWILIO_WEBHOOK_BASE_URL to the
// exact public origin Twilio is configured with (e.g. https://app.cleano.com)
// if the auto-detected origin ever mismatches behind proxies.

export const runtime = "nodejs";

/**
 * The AI receptionist's front door. Texts used to be silently dropped in two
 * places — a number we don't recognise as a client, and a client with no
 * active booking to thread onto. Those are exactly the messages worth
 * answering (the first one is a prospect), so when the workspace has turned
 * the assistant on, they go to it instead of to the void.
 *
 * The webhook answers Twilio IMMEDIATELY and the model call runs via after():
 * Twilio retries a slow webhook, and a retry would process the same text
 * twice. runAsOrg is re-entered inside the callback because after() runs when
 * the request-scoped org context is gone.
 */
function aiFallback(
  org: NonNullable<Awaited<ReturnType<typeof orgForInboundNumber>>>,
  phone: string,
  text: string,
  client: { id: string; name: string | null } | null,
): Promise<Response> {
  return getAiAssistantConfig().then((config) => {
    if (!config.enabled || !config.smsReplies) return twiml();
    after(() =>
      runAsOrg(org, () =>
        handleInboundAiMessage({
          channel: "SMS",
          address: phone,
          clientId: client?.id ?? null,
          clientName: client?.name ?? null,
          text,
          dailyMessageCap: config.dailyMessageCap,
          deliver: async (body) => (await sendSms({ to: phone, body })).sent,
        }),
      ),
    );
    return twiml();
  });
}

function twiml(body = ""): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
    { status: 200, headers: { "Content-Type": "text/xml" } },
  );
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries())
    params[k] = typeof v === "string" ? v : "";

  // ── Routing BEFORE verification, deliberately ─────────────────────────────
  //
  // Twilio signs with the auth token of the account the number lives in, and a
  // company that brought its own Twilio account signs with THEIR token. So the
  // workspace has to be identified before there is a token to check against.
  //
  // This is safe because the lookup is not trust: `To` is only a key into our
  // own table of numbers we serve, nothing is written, and every path below
  // still refuses the request unless the signature verifies against that
  // workspace's own credentials. Validating everything against the platform
  // token instead would 403 every text a bring-your-own company received —
  // silently, from Twilio's side, which is exactly the failure that hid for
  // eighteen days on the old stack.
  //
  // No match means a number we do not serve: accept and ignore, rather than
  // guessing a workspace and filing a stranger's message in it.
  const org = await orgForInboundNumber(params.To ?? "");
  if (!org) return twiml();

  const resolved = await twilioForOrgId(org.id);
  if (!resolved.ok) {
    // Either they connected an account whose token no longer decrypts, or
    // nothing is configured at all. Accept-and-ignore so Twilio does not
    // retry-storm, and leave a row the admin can actually find.
    after(() =>
      runAsOrg(org, () =>
        logAiFailed(
          { address: params.From ?? null },
          `A text arrived on ${params.To ?? "this workspace's number"} but it could not be verified.`,
          resolved.reason === "unreadable"
            ? "The saved Twilio credentials could not be read. Reconnect Twilio in Settings → Connectors."
            : "No Twilio account is connected for this workspace.",
        ),
      ),
    );
    return twiml();
  }

  // Reconstruct the exact URL Twilio signed.
  const base =
    process.env.TWILIO_WEBHOOK_BASE_URL ??
    `${req.headers.get("x-forwarded-proto") ?? "https"}://${req.headers.get("host") ?? ""}`;
  const url = `${base}/api/twilio/inbound`;

  const signature = req.headers.get("x-twilio-signature");
  if (!isValidTwilioSignature(url, params, signature, resolved.creds.authToken)) {
    return new Response("Invalid signature", { status: 403 });
  }

  // Verified and ours. Pass a copy on to whatever the workspace is migrating
  // FROM, before any of the branching below — a message we choose not to act on
  // (no body, unparseable number, chat closed) is still a message the other
  // system would have received, and a relay with holes in it is worse than none.
  after(() => runAsOrg(org, () => forwardInboundText(params, resolved.creds.authToken)));

  const from = params.From ?? "";
  const bodyText = (params.Body ?? "").trim();
  if (!bodyText) return twiml();

  const phone = toE164(from);
  if (!phone) return twiml();

  return runAsOrg(org, async () => {
    // Match the sender's phone to a client (primary or secondary number).
    const client = await db.client.findFirst({
      where: { OR: [{ phone }, { secondaryPhone: phone }] },
      select: { id: true, name: true },
    });
    // Not a client — a prospect, or a wrong number. The assistant's best case.
    if (!client) return aiFallback(org, phone, bodyText, null);

    // Find the most relevant job to attach the reply to: the client's thread with
    // the most recent chat activity, else their nearest active (non-cancelled)
    // job. This keeps a running conversation on the same thread.
    //
    // Ordered by the newest MESSAGE, not by message count. Counting meant a
    // client's chattiest old booking captured every later reply forever, so
    // answers to a recent "I'm on my way" landed on a months-old job.
    //
    // Bounded to a recent window so a long-dormant thread doesn't swallow what is
    // really a new conversation — past that, the active-job fallback is better.
    const RETHREAD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
    const latestChat = await db.jobChatMessage.findFirst({
      where: {
        job: { clientId: client.id },
        createdAt: { gte: new Date(Date.now() - RETHREAD_WINDOW_MS) },
      },
      orderBy: { createdAt: "desc" },
      select: { jobId: true },
    });

    let jobId = latestChat?.jobId ?? null;
    if (!jobId) {
      const activeJob = await db.job.findFirst({
        where: {
          clientId: client.id,
          status: { in: ["CREATED", "SCHEDULED", "IN_PROGRESS", "COMPLETED"] },
        },
        orderBy: { startTime: "desc" },
        select: { id: true },
      });
      jobId = activeJob?.id ?? null;
    }

    // A client, but nothing to thread onto — no recent chat, no active job.
    // That's a general question, not job talk, so the assistant may take it.
    if (!jobId) return aiFallback(org, phone, bodyText, client);

    // CLN-P0-3-14 — an admin who turned messaging off for this booking, or for
    // this customer, must not be bypassed by the customer texting instead. This
    // is the one write path into job chat with no session behind it, so the check
    // cannot come from resolveParticipant. Silently accepted (empty TwiML) rather
    // than answered: telling a blocked sender they are blocked invites a retry
    // storm, and Twilio would keep redelivering a non-2xx.
    if (!(await isJobChatOpenForClient(jobId, client.id))) return twiml();

    await db.jobChatMessage.create({
      data: {
        jobId,
        senderId: null,
        senderRole: "CLIENT",
        senderName: client.name ?? "Client",
        body: bodyText,
        readByClientAt: new Date(), // the client obviously saw their own message
      },
    });

    return twiml();
  });
}
