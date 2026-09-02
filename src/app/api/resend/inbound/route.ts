import { NextRequest, after } from "next/server";
import crypto from "crypto";
import { runAsOrg } from "@/lib/org-context";
import { platformDb } from "@/lib/platform-db";
import { db } from "@/lib/org-db";
import { isValidOrgSlug } from "@/lib/tenant";
import { sendConversationalEmailReply } from "@/lib/email";
import { getAiAssistantConfig } from "@/lib/ai-assistant/knowledge";
import { handleInboundAiMessage } from "@/lib/ai-assistant/conversation";

/**
 * The email leg of the AI receptionist. Resend's inbound email product POSTs
 * an `email.received` event here for mail sent to the platform's inbound
 * domain. The recipient's local part names the workspace:
 *
 *     cleano@in.useawer.com  →  the "cleano" workspace
 *
 * A company without domain email just forwards their Gmail to their inbound
 * address and the platform sees everything; a company with one points MX or a
 * forwarding rule the same way. Either way the sender's real address survives
 * as `from`, which is who the assistant replies to.
 *
 * Setup (one-time, platform level):
 *   - Verify the inbound domain in Resend and enable inbound email on it.
 *   - Point the inbound webhook at  https://<apex>/api/resend/inbound
 *   - Env: RESEND_INBOUND_SECRET  (the endpoint's signing secret, `whsec_…`)
 *          INBOUND_EMAIL_DOMAIN   (e.g. "in.useawer.com")
 *
 * Ships dark like the rest of the assistant: with the secret unset the route
 * acknowledges and ignores, so deploying this before Resend is configured
 * changes nothing.
 */

export const runtime = "nodejs";

/**
 * Svix-style webhook signature, implemented directly (Resend signs with the
 * standard webhooks spec): base64(HMAC-SHA256(secret, `${id}.${ts}.${body}`)),
 * matched against any of the space-separated `v1,<sig>` entries.
 */
function isValidSignature(
  body: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string,
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;

  // Refuse replays: the spec allows a small clock window, five minutes here.
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${body}`)
    .digest("base64");

  return headers.signature.split(" ").some((part) => {
    const sig = part.includes(",") ? part.slice(part.indexOf(",") + 1) : part;
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    } catch {
      return false;
    }
  });
}

/** "Name <addr@x.y>" | "addr@x.y" → "addr@x.y" lowercased, or null. */
function bareAddress(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/<([^<>\s]+@[^<>\s]+)>/) ?? raw.match(/([^\s<>,;]+@[^\s<>,;]+)/);
  return m ? m[1].toLowerCase() : null;
}

/** Strip an html body down to readable text, for mail with no text part. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const ok = () => Response.json({ received: true });

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_INBOUND_SECRET;
  if (!secret) return ok(); // not configured yet — acknowledge and ignore

  const body = await req.text();
  const valid = isValidSignature(
    body,
    {
      id: req.headers.get("svix-id"),
      timestamp: req.headers.get("svix-timestamp"),
      signature: req.headers.get("svix-signature"),
    },
    secret,
  );
  if (!valid) return new Response("invalid signature", { status: 401 });

  let event: {
    type?: string;
    data?: {
      from?: string;
      to?: string | string[];
      subject?: string;
      text?: string;
      html?: string;
      headers?: Record<string, string> | Array<{ name?: string; value?: string }>;
      message_id?: string;
    };
  };
  try {
    event = JSON.parse(body);
  } catch {
    return ok();
  }
  if (event.type !== "email.received" || !event.data) return ok();
  const data = event.data;

  // Which workspace was this addressed to? The inbound domain's local part.
  const inboundDomain = (process.env.INBOUND_EMAIL_DOMAIN ?? "").toLowerCase().trim();
  if (!inboundDomain) return ok();
  const recipients = (Array.isArray(data.to) ? data.to : [data.to])
    .map(bareAddress)
    .filter((a): a is string => !!a);
  const inboundAddr = recipients.find((a) => a.endsWith(`@${inboundDomain}`));
  if (!inboundAddr) return ok();
  const slug = inboundAddr.split("@")[0];
  if (!isValidOrgSlug(slug)) return ok();

  const from = bareAddress(data.from);
  if (!from) return ok();

  // Never talk to machines: our own sends, bounce addresses, list mail.
  // (An email loop between two auto-repliers is the classic failure here.)
  const fromLocal = from.split("@")[0];
  if (
    from.endsWith(`@${inboundDomain}`) ||
    /^(no-?reply|noreply|mailer-daemon|postmaster|bounce)/i.test(fromLocal)
  ) {
    return ok();
  }
  const headerList: Array<{ name: string; value: string }> = Array.isArray(data.headers)
    ? data.headers.map((h) => ({ name: String(h?.name ?? ""), value: String(h?.value ?? "") }))
    : Object.entries(data.headers ?? {}).map(([name, value]) => ({ name, value: String(value) }));
  const header = (n: string) =>
    headerList.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? null;
  const auto = (header("Auto-Submitted") ?? "").toLowerCase();
  if ((auto && auto !== "no") || header("List-Id")) return ok();

  const subject = (data.subject ?? "").trim() || "(no subject)";
  const text = (data.text ?? "").trim() || htmlToText(data.html ?? "");
  if (!text) return ok();

  const messageId = header("Message-ID") ?? data.message_id ?? null;

  const org = await platformDb.organization.findFirst({
    where: { slug, status: "ACTIVE" },
    select: { id: true, slug: true, name: true, timezone: true },
  });
  if (!org) return ok();

  // Same shape as the Twilio route: answer the webhook NOW, think in after().
  const config = await runAsOrg(org, () => getAiAssistantConfig());
  if (!config.enabled || !config.emailReplies) return ok();

  after(() =>
    runAsOrg(org, async () => {
      const client = await db.client
        .findFirst({ where: { email: from }, select: { id: true, name: true } })
        .catch(() => null);

      const replySubject = /^re:/i.test(subject) ? subject : `Re: ${subject}`;
      const result = await handleInboundAiMessage({
        channel: "EMAIL",
        address: from,
        clientId: client?.id ?? null,
        clientName: client?.name ?? null,
        // The subject is part of what the customer said, not metadata to the model.
        text: `Subject: ${subject}\n\n${text}`.slice(0, 8000),
        dailyMessageCap: config.dailyMessageCap,
        deliver: (replyText) =>
          sendConversationalEmailReply({
            to: from,
            subject: replySubject,
            text: replyText,
            inReplyTo: messageId,
          }),
      });

      // Remember the thread's subject + newest Message-ID so staff replies
      // from the Conversations page land in the same email thread.
      if (result) {
        await db.aiConversation
          .update({
            where: { id: result.conversationId },
            data: {
              ...(messageId ? { lastEmailMessageId: messageId } : {}),
              subject: { set: subject },
            },
          })
          .catch(() => {});
      }
    }),
  );

  return ok();
}
