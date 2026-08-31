/**
 * Mail from Awer itself, as opposed to mail from a cleaning company.
 *
 * Everything in lib/email.ts is a TENANT's mail: it writes to that company's
 * EmailLog, and every send is gated by their Settings → Notifications toggles.
 * Both are right for a booking confirmation and wrong for this. A new
 * workspace's owner must receive their own sign-in details whatever their
 * notification settings happen to say — they have never seen those settings,
 * because they cannot get in yet — and the send belongs to Awer, not to the
 * company being created.
 *
 * So this is a deliberately small, separate path: direct to Resend, Awer's own
 * sender, no tenant context required. It is used from the console, which runs
 * as platform staff and has no tenant to scope to in the first place.
 */
import { Resend } from "resend";

/**
 * Awer's own sender, distinct from EMAIL_FROM.
 *
 * EMAIL_FROM is the cleaning company's address — "Cleano <no-reply@cleano.ca>"
 * in production — and a welcome to Awer arriving from one of Awer's customers
 * would be a confusing first impression for the next one. Falls back to
 * EMAIL_FROM only so that an unconfigured environment still sends something
 * rather than nothing.
 */
const PLATFORM_FROM =
  process.env.PLATFORM_EMAIL_FROM ??
  process.env.EMAIL_FROM ??
  "Awer <no-reply@useawer.com>";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function send(opts: { to: string; subject: string; html: string }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[platform-email] RESEND_API_KEY is not set — not sent");
    return { ok: false as const, error: "RESEND_API_KEY not configured" };
  }
  try {
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: PLATFORM_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    if (error) return { ok: false as const, error: String(error.message ?? error) };
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "send failed" };
  }
}

/**
 * The one email a staff-created workspace cannot do without.
 *
 * It carries a password in the body, which is normally worth avoiding — and is
 * the right call here. The alternative is what we had: a one-time password
 * shown once on the screen of whoever pressed the button, with no recovery
 * path, so losing that browser tab locked the customer out of a workspace they
 * had just been sold. This password is single-use in practice: the account is
 * flagged `mustChangePassword`, so it buys exactly one sign-in and is then
 * replaced by one Awer never sees.
 */
export async function sendWorkspaceCredentials(opts: {
  to: string;
  ownerName: string;
  companyName: string;
  /** Absolute origin of their workspace, e.g. https://cleanocalgary.useawer.com */
  origin: string;
  password: string;
  /** True when this replaces a password that was lost, rather than a first issue. */
  reissued?: boolean;
}) {
  const first = opts.ownerName.trim().split(/\s+/)[0] || "there";
  const signIn = `${opts.origin.replace(/\/+$/, "")}/sign-in`;
  const heading = opts.reissued
    ? `A new password for ${esc(opts.companyName)}`
    : `${esc(opts.companyName)} is ready`;
  const opener = opts.reissued
    ? `Here is a new password for your Awer workspace. The previous one no longer works.`
    : `Your Awer workspace is set up and waiting for you. Here is how to get in.`;

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:28px 24px;color:#0e1a1c">
  <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#008C9C">Awer</p>
  <h1 style="margin:0 0 14px;font-size:22px;font-weight:600">${heading}</h1>
  <p style="margin:0 0 18px;font-size:15px;line-height:1.6">Hi ${esc(first)}, ${opener}</p>

  <table style="width:100%;border-collapse:collapse;background:#f6f9fa;border-radius:12px;margin-bottom:18px">
    <tr><td style="padding:14px 16px 4px;font-size:12px;color:#5b6b6d">Your address</td></tr>
    <tr><td style="padding:0 16px 12px;font-size:15px;font-weight:600">
      <a href="${esc(signIn)}" style="color:#005a63">${esc(opts.origin.replace(/^https?:\/\//, ""))}</a>
    </td></tr>
    <tr><td style="padding:0 16px 4px;font-size:12px;color:#5b6b6d">Sign in with</td></tr>
    <tr><td style="padding:0 16px 12px;font-size:15px;font-weight:600">${esc(opts.to)}</td></tr>
    <tr><td style="padding:0 16px 4px;font-size:12px;color:#5b6b6d">Password</td></tr>
    <tr><td style="padding:0 16px 16px;font-size:16px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${esc(opts.password)}</td></tr>
  </table>

  <p style="margin:0 0 20px;font-size:14px;line-height:1.6">
    You will be asked to choose your own password the first time you sign in, so this one
    stops working straight away. Nobody at Awer can see what you replace it with.
  </p>

  <a href="${esc(signIn)}" style="display:inline-block;background:#008C9C;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-size:15px;font-weight:600">Sign in to ${esc(opts.companyName)}</a>

  <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#5b6b6d">
    Once you are in, your dashboard opens with a short list of what to set up first —
    the areas you cover, your prices, your sales tax and your cleaners. Work down it and
    you can take your first booking the same afternoon.
  </p>
</div>`.trim();

  return send({
    to: opts.to,
    subject: opts.reissued
      ? `Your new password for ${opts.companyName}`
      : `${opts.companyName} is ready on Awer`,
    html,
  });
}
