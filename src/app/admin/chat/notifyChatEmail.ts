import { Resend } from "resend";
import { db } from "@/db";
import { isNotificationEnabled } from "@/lib/notifications";

const FROM = process.env.EMAIL_FROM ?? "Cleano <no-reply@cleano.ca>";

// Don't email more than once every 5 minutes per conversation+direction.
const EMAIL_THROTTLE_MS = 5 * 60 * 1000;

function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

function appUrl(path: string) {
  const base = process.env.APP_URL ?? "https://teamcleano-software.vercel.app";
  return `${base.replace(/\/$/, "")}${path}`;
}

function buildHtml(opts: {
  recipientName: string;
  senderName: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  const safeBody = opts.body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .slice(0, 280);
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f5f0;padding:32px 16px;color:#003C46">
    <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px 24px;box-shadow:0 2px 14px rgba(0,0,0,0.05)">
      <p style="font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#008C9C;opacity:0.7;margin:0 0 8px">New message</p>
      <h1 style="margin:0 0 16px;font-size:22px;color:#003C46;font-weight:700">${opts.senderName} messaged you on Cleano</h1>
      <p style="margin:0 0 8px;font-size:14px;color:#5a6e72">Hi ${opts.recipientName.split(" ")[0] ?? ""},</p>
      <blockquote style="margin:14px 0 18px;padding:14px 16px;background:#f4f8f9;border-left:3px solid #008C9C;border-radius:6px;color:#003C46;font-size:14.5px;line-height:1.5;white-space:pre-wrap">${safeBody}</blockquote>
      <a href="${opts.ctaHref}" style="display:inline-block;padding:11px 22px;background:#008C9C;color:#fff;border-radius:10px;text-decoration:none;font-size:14px;font-weight:600">${opts.ctaLabel}</a>
      <p style="margin:22px 0 0;font-size:11.5px;color:#9aa6a8">You're receiving this because chat email notifications are enabled. An admin can turn them off in Settings → Notifications.</p>
    </div>
  </div>`;
}

export async function notifyChatEmail(opts: {
  conversationId: string;
  senderRole: "EMPLOYEE" | "ADMIN";
  senderName: string;
  body: string;
  recipientOnline: boolean;
}) {
  // Don't bother if the recipient is actively online — they'll see the in-app
  // toast / badge.
  if (opts.recipientOnline) return;

  const convo = await db.chatConversation.findUnique({
    where: { id: opts.conversationId },
    include: {
      employee: { select: { id: true, name: true, email: true, role: true } },
    },
  });
  if (!convo) return;

  const now = new Date();

  if (opts.senderRole === "EMPLOYEE") {
    // Cleaner → Admin. Email all admins. Throttle via lastAdminEmailAt.
    if (
      convo.lastAdminEmailAt &&
      now.getTime() - convo.lastAdminEmailAt.getTime() < EMAIL_THROTTLE_MS
    ) {
      return;
    }
    const enabled = await isNotificationEnabled("ADMIN", "admin.chat.customer_provider_msg", "EMAIL");
    if (!enabled) return;

    const admins = await db.user.findMany({
      where: { role: { in: ["OWNER", "ADMIN", "OPS_MANAGER", "FIELD_LEAD"] } },
      select: { id: true, name: true, email: true },
    });
    if (admins.length === 0) return;

    const resend = getResend();
    if (!resend) return;

    const subject = `Cleaner (${opts.senderName}) messaged you on Cleano`;
    const ctaHref = appUrl(`/admin/chat?employeeId=${convo.employee.id}`);
    for (const admin of admins) {
      try {
        await resend.emails.send({
          from: FROM,
          to: admin.email,
          subject,
          html: buildHtml({
            recipientName: admin.name,
            senderName: `Cleaner ${opts.senderName}`,
            body: opts.body,
            ctaLabel: "Open chat",
            ctaHref,
          }),
        });
      } catch (e) {
        console.error("notifyChatEmail (to admin) failed", e);
      }
    }
    await db.chatConversation.update({
      where: { id: opts.conversationId },
      data: { lastAdminEmailAt: now },
    });
  } else {
    // Admin → Cleaner. Email the employee. Throttle via lastEmployeeEmailAt.
    if (
      convo.lastEmployeeEmailAt &&
      now.getTime() - convo.lastEmployeeEmailAt.getTime() < EMAIL_THROTTLE_MS
    ) {
      return;
    }
    const enabled = await isNotificationEnabled("PROVIDER", "prov.chat.new_message_v2", "EMAIL");
    if (!enabled) return;

    const resend = getResend();
    if (!resend) return;

    try {
      await resend.emails.send({
        from: FROM,
        to: convo.employee.email,
        subject: `${opts.senderName} messaged you on Cleano`,
        html: buildHtml({
          recipientName: convo.employee.name,
          senderName: opts.senderName,
          body: opts.body,
          ctaLabel: "Open chat",
          ctaHref: appUrl("/admin/chat"),
        }),
      });
      await db.chatConversation.update({
        where: { id: opts.conversationId },
        data: { lastEmployeeEmailAt: now },
      });
    } catch (e) {
      console.error("notifyChatEmail (to employee) failed", e);
    }
  }
}
