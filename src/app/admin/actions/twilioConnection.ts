"use server";

import { revalidatePath } from "next/cache";

import { requireOwnerAdmin } from "@/lib/action-guards";
import { platformDb } from "@/lib/platform-db";
import { requireOrgId } from "@/lib/org";
import { canStoreSecrets, hint as secretHint, seal } from "@/lib/secret-box";
import { logActivity } from "@/lib/activity-log";
import { twilioForOrgId } from "@/lib/twilio-org";

type Result = { ok: true; message: string } | { ok: false; message: string };

const API = "https://api.twilio.com/2010-04-01";

function auth(sid: string, token: string) {
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

/**
 * Connect a workspace's own Twilio account.
 *
 * The credentials are PROVED before they are stored: a token that is merely
 * saved looks connected and fails at the worst possible moment — the first
 * time a customer texts. Twilio's own account endpoint is the cheapest honest
 * check, and it also confirms the account is active rather than suspended.
 */
export async function connectTwilio(input: {
  accountSid: string;
  authToken: string;
}): Promise<Result> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false, message: guard.error };

  if (!canStoreSecrets()) {
    return {
      ok: false,
      message:
        "This deployment cannot store credentials yet (SECRETS_KEY is not set). Nothing was saved.",
    };
  }

  const accountSid = input.accountSid.trim();
  const authToken = input.authToken.trim();
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) {
    return { ok: false, message: "That doesn't look like an Account SID. It starts with AC." };
  }
  if (authToken.length < 20) {
    return { ok: false, message: "That auth token looks too short. Copy it from your Twilio console." };
  }

  let res: Response;
  try {
    res = await fetch(`${API}/Accounts/${accountSid}.json`, {
      headers: { Authorization: auth(accountSid, authToken) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, message: "Couldn't reach Twilio just now. Nothing was saved — try again." };
  }
  if (res.status === 401) {
    return { ok: false, message: "Twilio rejected those credentials. Check the SID and auth token." };
  }
  if (!res.ok) {
    return { ok: false, message: `Twilio replied ${res.status}. Nothing was saved.` };
  }
  const account = (await res.json().catch(() => ({}))) as { status?: string; friendly_name?: string };
  if (account.status && account.status !== "active") {
    return { ok: false, message: `That Twilio account is ${account.status}, not active.` };
  }

  const orgId = await requireOrgId();
  await platformDb.organization.update({
    where: { id: orgId },
    data: {
      twilioAccountSid: accountSid,
      twilioAuthTokenEnc: seal(authToken),
      twilioTokenHint: secretHint(authToken),
      twilioConnectedAt: new Date(),
    },
  });

  await logActivity({
    category: "ADMIN",
    action: "twilio.connected",
    status: "SUCCESS",
    actorId: guard.userId,
    // The SID identifies the account and is not a secret; the token never is.
    message: `Connected Twilio account ${account.friendly_name ?? accountSid}.`,
  });

  revalidatePath("/admin/settings");
  return {
    ok: true,
    message: `Connected to ${account.friendly_name ?? "your Twilio account"}. Texts will now send and receive on it.`,
  };
}

/** Go back to Awer's Twilio account. */
export async function disconnectTwilio(): Promise<Result> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false, message: guard.error };

  const orgId = await requireOrgId();
  await platformDb.organization.update({
    where: { id: orgId },
    data: {
      twilioAccountSid: null,
      twilioAuthTokenEnc: null,
      twilioTokenHint: null,
      twilioConnectedAt: null,
    },
  });
  await logActivity({
    category: "ADMIN",
    action: "twilio.disconnected",
    status: "SUCCESS",
    actorId: guard.userId,
    message: "Disconnected the workspace's own Twilio account.",
  });
  revalidatePath("/admin/settings");
  return { ok: true, message: "Disconnected. Texting falls back to Awer's account." };
}

export interface TwilioTest {
  ok: boolean;
  /** Plain-English lines, each already true or false. */
  checks: { label: string; pass: boolean; detail: string }[];
}

/**
 * Prove the whole path, not just the credentials.
 *
 * This exists because of a real, expensive failure: on the previous stack a
 * number's inbound webhook was simply blank while a dashboard showed a green
 * "Automatically Configured" banner, and eighteen days of customer texts were
 * dropped before anyone noticed. So this does not report what we believe — it
 * asks Twilio what IS configured and shows the answer.
 */
export async function testTwilio(): Promise<TwilioTest> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) {
    return { ok: false, checks: [{ label: "Permission", pass: false, detail: guard.error }] };
  }

  const orgId = await requireOrgId();
  const checks: TwilioTest["checks"] = [];

  const org = await platformDb.organization.findUnique({
    where: { id: orgId },
    select: { slug: true, smsNumber: true, smsMessagingServiceSid: true },
  });
  const resolved = await twilioForOrgId(orgId);

  if (!resolved.ok) {
    checks.push({
      label: "Twilio account",
      pass: false,
      detail:
        resolved.reason === "unreadable"
          ? "The saved credentials could not be read. Reconnect the account."
          : "No Twilio account is connected, and this deployment has no shared account either.",
    });
    return { ok: false, checks };
  }
  const { accountSid, authToken, source } = resolved.creds;
  checks.push({
    label: "Twilio account",
    pass: true,
    detail: source === "workspace" ? `Using your own account (${accountSid}).` : "Using Awer's shared account.",
  });

  if (!org?.smsNumber) {
    checks.push({
      label: "Phone number",
      pass: false,
      detail: "No number is assigned to this workspace yet, so customers have nowhere to text.",
    });
    return { ok: false, checks };
  }

  // Does the number actually live in this account, and where does Twilio think
  // its inbound messages should go?
  let numbers: {
    incoming_phone_numbers?: {
      phone_number?: string;
      sms_url?: string;
      messaging_service_sid?: string | null;
      friendly_name?: string;
    }[];
  } = {};
  try {
    const r = await fetch(
      `${API}/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(org.smsNumber)}`,
      { headers: { Authorization: auth(accountSid, authToken) }, signal: AbortSignal.timeout(15_000) },
    );
    if (r.status === 401) {
      checks.push({ label: "Credentials", pass: false, detail: "Twilio rejected the saved credentials." });
      return { ok: false, checks };
    }
    numbers = (await r.json()) as typeof numbers;
  } catch {
    checks.push({ label: "Phone number", pass: false, detail: "Couldn't reach Twilio to check the number." });
    return { ok: false, checks };
  }

  const match = numbers.incoming_phone_numbers?.[0];
  if (!match) {
    checks.push({
      label: "Phone number",
      pass: false,
      detail: `${org.smsNumber} is not in this Twilio account. Check the number, or connect the account that owns it.`,
    });
    return { ok: false, checks };
  }
  checks.push({ label: "Phone number", pass: true, detail: `${org.smsNumber} belongs to this account.` });

  // The check that would have caught the eighteen-day outage.
  const expected = "/api/twilio/inbound";
  const serviceSid = match.messaging_service_sid || org.smsMessagingServiceSid || null;

  if (serviceSid) {
    // A Messaging Service ALWAYS overrides the number's own webhook, so when
    // one is attached it is the only configuration that matters.
    try {
      const r = await fetch(`https://messaging.twilio.com/v1/Services/${serviceSid}`, {
        headers: { Authorization: auth(accountSid, authToken) },
        signal: AbortSignal.timeout(15_000),
      });
      const svc = (await r.json()) as { inbound_request_url?: string | null; friendly_name?: string };
      const url = svc.inbound_request_url ?? "";
      checks.push({
        label: "Incoming messages",
        pass: url.includes(expected),
        detail: url
          ? url.includes(expected)
            ? `Messaging Service "${svc.friendly_name ?? serviceSid}" delivers incoming texts to us.`
            : `Messaging Service "${svc.friendly_name ?? serviceSid}" sends incoming texts to ${url}, not to us. Customer replies will not arrive.`
          : `Messaging Service "${svc.friendly_name ?? serviceSid}" has NO inbound webhook set, so Twilio drops every incoming text silently. Set its inbound request URL to ${expected}.`,
      });
    } catch {
      checks.push({
        label: "Incoming messages",
        pass: false,
        detail: "Couldn't read the Messaging Service configuration from Twilio.",
      });
    }
  } else {
    const url = match.sms_url ?? "";
    checks.push({
      label: "Incoming messages",
      pass: url.includes(expected),
      detail: url
        ? url.includes(expected)
          ? "Twilio delivers incoming texts to us."
          : `Twilio sends incoming texts to ${url}, not to us. Customer replies will not arrive.`
        : "This number has no inbound webhook set, so Twilio drops every incoming text silently.",
    });
  }

  return { ok: checks.every((c) => c.pass), checks };
}
