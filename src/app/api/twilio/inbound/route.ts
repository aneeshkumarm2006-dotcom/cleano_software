import { NextRequest } from "next/server";
import crypto from "crypto";
import { db } from "@/db";
import { toE164 } from "@/lib/sms";

// Inbound leg of the job-specific chat SMS bridge (#11). Twilio POSTs here
// (application/x-www-form-urlencoded) when a client texts the Cleano number.
// We verify the Twilio signature, match the sender's phone to a client + their
// active job, and append the reply to that job's chat thread as a CLIENT
// message — so it appears in the cleaner/admin app. Returns empty TwiML.
//
// Twilio setup: point the Messaging Service (or number) "A message comes in"
// webhook (HTTP POST) at  https://<your-domain>/api/twilio/inbound
// Requires TWILIO_AUTH_TOKEN. Optionally set TWILIO_WEBHOOK_BASE_URL to the
// exact public origin Twilio is configured with (e.g. https://app.cleano.com)
// if the auto-detected origin ever mismatches behind proxies.

export const runtime = "nodejs";

// Validates X-Twilio-Signature per Twilio's spec: base64(HMAC-SHA1(authToken,
// fullUrl + sorted(key+value) concatenated)).
function isValidTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
  authToken: string
): boolean {
  if (!signature) return false;
  const data =
    url +
    Object.keys(params)
      .sort()
      .reduce((acc, key) => acc + key + params[key], "");
  const expected = crypto
    .createHmac("sha1", authToken)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

function twiml(body = ""): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
    { status: 200, headers: { "Content-Type": "text/xml" } }
  );
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    // Not configured yet — accept-and-ignore so Twilio doesn't retry-storm.
    return twiml();
  }

  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = typeof v === "string" ? v : "";

  // Reconstruct the exact URL Twilio signed.
  const base =
    process.env.TWILIO_WEBHOOK_BASE_URL ??
    `${req.headers.get("x-forwarded-proto") ?? "https"}://${req.headers.get("host") ?? ""}`;
  const url = `${base}/api/twilio/inbound`;

  const signature = req.headers.get("x-twilio-signature");
  if (!isValidTwilioSignature(url, params, signature, authToken)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const from = params.From ?? "";
  const bodyText = (params.Body ?? "").trim();
  if (!bodyText) return twiml();

  const phone = toE164(from);
  if (!phone) return twiml();

  // Match the sender's phone to a client (primary or secondary number).
  const client = await db.client.findFirst({
    where: { OR: [{ phone }, { secondaryPhone: phone }] },
    select: { id: true, name: true },
  });
  if (!client) return twiml();

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

  if (!jobId) return twiml();

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
}
