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
  const numberUrl = match.sms_url ?? "";

  // The number's own messaging_service_sid is unreliable (see
  // messagingServiceMap), so fall back to asking the sender pools.
  const serviceSid =
    match.messaging_service_sid ||
    org.smsMessagingServiceSid ||
    (await messagingServiceMap(accountSid, authToken)).get(org.smsNumber)?.sid ||
    null;

  const pushInbound = (pass: boolean, detail: string) =>
    checks.push({ label: "Incoming messages", pass, detail });

  if (!serviceSid) {
    pushInbound(
      numberUrl.includes(expected),
      numberUrl
        ? numberUrl.includes(expected)
          ? "Twilio delivers incoming texts to us."
          : `Twilio sends incoming texts to ${numberUrl}, not to us. Customer replies will not arrive.`
        : "This number has no inbound webhook set, so Twilio drops every incoming text silently.",
    );
  } else {
    // A Messaging Service does NOT automatically win: `use_inbound_webhook_on_number`
    // tells it to defer to the number instead. Guessing which one is in charge is
    // how a webhook gets "fixed" in the place Twilio was never reading, so ask.
    type Service = {
      inbound_request_url?: string | null;
      friendly_name?: string;
      use_inbound_webhook_on_number?: boolean;
    };
    let svc: Service | null = null;
    try {
      const r = await fetch(`https://messaging.twilio.com/v1/Services/${serviceSid}`, {
        headers: { Authorization: auth(accountSid, authToken) },
        signal: AbortSignal.timeout(15_000),
      });
      if (r.ok) svc = (await r.json()) as Service;
    } catch {
      /* reported below */
    }

    if (!svc) {
      pushInbound(false, "Couldn't read the Messaging Service configuration from Twilio.");
    } else {
      const name = svc.friendly_name || serviceSid;
      if (svc.use_inbound_webhook_on_number) {
        pushInbound(
          numberUrl.includes(expected),
          numberUrl.includes(expected)
            ? `Messaging Service "${name}" defers to the number, and the number delivers to us.`
            : numberUrl
              ? `Messaging Service "${name}" is set to defer to the number's own webhook, and that webhook points at ${numberUrl}, not us. Change the number's webhook, or turn off "Use the webhook configured on the sender" in the service and set its inbound URL instead.`
              : `Messaging Service "${name}" defers to the number's own webhook, and the number has none set, so Twilio drops every incoming text silently.`,
        );
      } else {
        const url = svc.inbound_request_url ?? "";
        pushInbound(
          url.includes(expected),
          url
            ? url.includes(expected)
              ? `Messaging Service "${name}" delivers incoming texts to us.`
              : `Messaging Service "${name}" sends incoming texts to ${url}, not to us. Customer replies will not arrive.`
            : `Messaging Service "${name}" has NO inbound webhook set, so Twilio drops every incoming text silently. Set its inbound request URL.`,
        );
      }
    }
  }

  // Whatever wins, say what the OTHER setting holds. A number that quietly
  // keeps a stranger's webhook is what a cutover leaves behind, and it becomes
  // live again the moment the service defers or the number leaves the pool.
  if (serviceSid && numberUrl && !numberUrl.includes(expected)) {
    checks.push({
      label: "Number's own webhook",
      pass: true,
      detail: `Unused while the Messaging Service is in charge, but still set to ${numberUrl}. Worth clearing once you are happy.`,
    });
  }

  return { ok: checks.every((c) => c.pass), checks };
}

/**
 * Which Messaging Service each number actually sends through.
 *
 * IncomingPhoneNumbers.messaging_service_sid is NOT trustworthy: a number added
 * to a service's sender pool frequently comes back with that field null, and
 * believing the null is the eighteen-day outage in miniature — we would check
 * and configure the number's own webhook while the service silently overrode
 * it. So ask the services what they hold, which is the direction Twilio
 * answers honestly. Best effort: a failure here degrades to "no service",
 * never to a wrong one.
 */
async function messagingServiceMap(
  accountSid: string,
  authToken: string,
): Promise<Map<string, { sid: string; name: string }>> {
  const map = new Map<string, { sid: string; name: string }>();
  const headers = { Authorization: auth(accountSid, authToken) };
  let services: { sid?: string; friendly_name?: string }[] = [];
  try {
    const r = await fetch("https://messaging.twilio.com/v1/Services?PageSize=50", {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return map;
    services = ((await r.json()) as { services?: typeof services }).services ?? [];
  } catch {
    return map;
  }

  await Promise.all(
    services.slice(0, 25).map(async (svc) => {
      if (!svc.sid) return;
      try {
        const r = await fetch(
          `https://messaging.twilio.com/v1/Services/${svc.sid}/PhoneNumbers?PageSize=100`,
          { headers, signal: AbortSignal.timeout(15_000) },
        );
        if (!r.ok) return;
        const body = (await r.json()) as { phone_numbers?: { phone_number?: string }[] };
        for (const n of body.phone_numbers ?? []) {
          if (n.phone_number && !map.has(n.phone_number)) {
            map.set(n.phone_number, { sid: svc.sid!, name: svc.friendly_name || svc.sid! });
          }
        }
      } catch {
        /* one unreadable service must not blank the rest */
      }
    }),
  );
  return map;
}

export interface TwilioNumber {
  phoneNumber: string;
  label: string;
  /** Can receive texts. A voice-only number never will, however it is wired. */
  sms: boolean;
  /** Already the texting number of a different workspace. */
  taken: boolean;
  messagingServiceSid: string | null;
  messagingServiceName: string | null;
}

export type TwilioNumberList =
  | { ok: true; numbers: TwilioNumber[] }
  | { ok: false; message: string };

/**
 * The numbers in the workspace's OWN Twilio account, so it can pick one itself.
 *
 * Offered ONLY to a workspace running its own account. On Awer's shared account
 * the numbers belong to the platform and to other tenants, and the number is
 * the routing key for every incoming text — listing them here would show one
 * company another company's numbers and let it capture their customer replies.
 * That case stays with platform staff on purpose.
 */
export async function listTwilioNumbers(): Promise<TwilioNumberList> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false, message: guard.error };

  const orgId = await requireOrgId();
  const resolved = await twilioForOrgId(orgId);
  if (!resolved.ok) {
    return {
      ok: false,
      message:
        resolved.reason === "unreadable"
          ? "The saved credentials could not be read. Reconnect the account first."
          : "Connect your Twilio account first.",
    };
  }
  if (resolved.creds.source !== "workspace") {
    return {
      ok: false,
      message: "Your workspace runs on Awer's shared account, so Awer assigns the number.",
    };
  }
  const { accountSid, authToken } = resolved.creds;

  let payload: {
    incoming_phone_numbers?: {
      phone_number?: string;
      friendly_name?: string;
      messaging_service_sid?: string | null;
      capabilities?: { sms?: boolean };
    }[];
  };
  try {
    const r = await fetch(
      `${API}/Accounts/${accountSid}/IncomingPhoneNumbers.json?PageSize=100`,
      { headers: { Authorization: auth(accountSid, authToken) }, signal: AbortSignal.timeout(15_000) },
    );
    if (r.status === 401) {
      return { ok: false, message: "Twilio rejected the saved credentials. Reconnect the account." };
    }
    if (!r.ok) return { ok: false, message: `Twilio replied ${r.status}.` };
    payload = (await r.json()) as typeof payload;
  } catch {
    return { ok: false, message: "Couldn't reach Twilio just now. Try again." };
  }

  const rows = payload.incoming_phone_numbers ?? [];
  const digits = rows.map((n) => n.phone_number ?? "").filter(Boolean);
  const services = await messagingServiceMap(accountSid, authToken);

  // Which of these is another workspace already routing on. Only the fact is
  // returned, never which workspace — that is not this tenant's business.
  const claimed = digits.length
    ? await platformDb.organization
        .findMany({
          where: { smsNumber: { in: digits }, id: { not: orgId } },
          select: { smsNumber: true },
        })
        .then((o) => new Set(o.map((x) => x.smsNumber)))
        .catch(() => new Set<string | null>())
    : new Set<string | null>();

  return {
    ok: true,
    numbers: rows
      .filter((n) => n.phone_number)
      .map((n) => {
        const svc = services.get(n.phone_number!) ?? null;
        return {
          phoneNumber: n.phone_number!,
          label: n.friendly_name?.trim() || n.phone_number!,
          sms: n.capabilities?.sms !== false,
          taken: claimed.has(n.phone_number!),
          messagingServiceSid: n.messaging_service_sid || svc?.sid || null,
          messagingServiceName: svc?.name ?? null,
        };
      }),
  };
}

/**
 * Point this workspace's texting at one of its own Twilio numbers.
 *
 * Ownership is PROVED against Twilio, never taken from the form: the number is
 * how an inbound text finds a workspace, so accepting a typed number would let
 * any admin redirect another company's customer replies into their own inbox.
 * Asking Twilio "is this number in the account you connected?" is the whole
 * reason a tenant can now do this without Awer staff.
 */
export async function claimTwilioNumber(input: { phoneNumber: string }): Promise<Result> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false, message: guard.error };

  const number = input.phoneNumber.trim();
  if (!/^\+[1-9]\d{7,14}$/.test(number)) {
    return { ok: false, message: "That doesn't look like a phone number in +1… form." };
  }

  const orgId = await requireOrgId();
  const resolved = await twilioForOrgId(orgId);
  if (!resolved.ok || resolved.creds.source !== "workspace") {
    return { ok: false, message: "Connect your own Twilio account before choosing a number." };
  }
  const { accountSid, authToken } = resolved.creds;

  let match:
    | { phone_number?: string; messaging_service_sid?: string | null; capabilities?: { sms?: boolean } }
    | undefined;
  try {
    const r = await fetch(
      `${API}/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(number)}`,
      { headers: { Authorization: auth(accountSid, authToken) }, signal: AbortSignal.timeout(15_000) },
    );
    if (r.status === 401) {
      return { ok: false, message: "Twilio rejected the saved credentials. Reconnect the account." };
    }
    const body = (await r.json()) as { incoming_phone_numbers?: (typeof match)[] };
    match = body.incoming_phone_numbers?.[0];
  } catch {
    return { ok: false, message: "Couldn't reach Twilio to confirm the number. Nothing changed." };
  }
  if (!match) {
    return { ok: false, message: `${number} is not in the Twilio account you connected.` };
  }
  if (match.capabilities?.sms === false) {
    return { ok: false, message: `${number} cannot receive texts — it is a voice-only number.` };
  }

  // A Messaging Service overrides the number for BOTH directions, so when the
  // number is in one we store it and send through it too. Mismatching those
  // (receiving on a service, sending from the bare number) is what breaks A2P
  // registration and quietly lowers delivery.
  const serviceSid =
    match.messaging_service_sid ||
    (await messagingServiceMap(accountSid, authToken)).get(number)?.sid ||
    null;

  try {
    await platformDb.organization.update({
      where: { id: orgId },
      data: { smsNumber: number, smsMessagingServiceSid: serviceSid },
    });
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      return {
        ok: false,
        message: `${number} is already the texting number of another Awer workspace. Pick a different one, or contact support if that looks wrong.`,
      };
    }
    return { ok: false, message: "Couldn't save the number. Nothing changed." };
  }

  await logActivity({
    category: "ADMIN",
    action: "twilio.number_claimed",
    status: "SUCCESS",
    actorId: guard.userId,
    message: `Set the workspace texting number to ${number}.`,
  });

  revalidatePath("/admin/settings");
  return {
    ok: true,
    message: serviceSid
      ? `${number} is now your texting number, sending through your Messaging Service. Point that service's inbound webhook at the address below, then run Test connection.`
      : `${number} is now your texting number. Point its inbound webhook at the address below, then run Test connection.`,
  };
}
