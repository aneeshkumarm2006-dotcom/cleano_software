// Which Twilio account a workspace uses, and the credentials to talk to it.
//
// Deliberately the same shape as lib/stripe-org.ts, because it is the same
// problem: a credential that may belong to the workspace, may belong to the
// platform, and must never fall through to somebody else's account.
//
//   workspace credentials  →  the platform's account  →  not configured
//
// A company that already runs Twilio (their numbers, their A2P brand
// registration, their bill) connects it and nothing moves. A company that has
// never heard of Twilio gets the platform account and never sees this. Both
// have to work: the first is Cleano, the second is everyone who signs up from
// an ad.
import "server-only";

import { open as openSecret } from "@/lib/secret-box";
import { platformDb } from "@/lib/platform-db";
import { orgFromContext } from "@/lib/org-context";
import { getCurrentOrg } from "@/lib/org";

export interface TwilioCreds {
  accountSid: string;
  authToken: string;
  /** Where the credentials came from — shown in settings, used in messages. */
  source: "workspace" | "platform";
}

export type TwilioResolution =
  | { ok: true; creds: TwilioCreds }
  /** They connected an account, but the stored token will not decrypt. */
  | { ok: false; reason: "unreadable" }
  | { ok: false; reason: "not-configured" };

type OrgRow = {
  twilioAccountSid: string | null;
  twilioAuthTokenEnc: string | null;
};

const SELECT = {
  twilioAccountSid: true,
  twilioAuthTokenEnc: true,
} as const;

function platformCreds(): TwilioCreds | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !authToken) return null;
  return { accountSid, authToken, source: "platform" };
}

function resolve(org: OrgRow | null): TwilioResolution {
  if (org?.twilioAccountSid && org.twilioAuthTokenEnc) {
    const authToken = openSecret(org.twilioAuthTokenEnc);
    // A token that will not decrypt — rotated SECRETS_KEY, a row copied between
    // environments — must NOT silently fall through to the platform account.
    // Sending this company's customers a text from a stranger's number, or
    // validating their webhooks against the wrong token, are both worse than
    // saying "reconnect your account".
    if (!authToken) return { ok: false, reason: "unreadable" };
    return { ok: true, creds: { accountSid: org.twilioAccountSid, authToken, source: "workspace" } };
  }

  const platform = platformCreds();
  return platform ? { ok: true, creds: platform } : { ok: false, reason: "not-configured" };
}

/** Twilio credentials for the organization this code is running as. */
export async function twilioForCurrentOrg(): Promise<TwilioResolution> {
  try {
    const ctx = orgFromContext();
    const org = ctx
      ? await platformDb.organization.findUnique({ where: { id: ctx.id }, select: SELECT })
      : await getCurrentOrg().then((o) =>
          o ? platformDb.organization.findUnique({ where: { id: o.id }, select: SELECT }) : null,
        );
    return resolve(org);
  } catch {
    // No request and no context. The platform account is the honest answer
    // here: it is what every send used before this file existed.
    const platform = platformCreds();
    return platform ? { ok: true, creds: platform } : { ok: false, reason: "not-configured" };
  }
}

/** Twilio credentials for a named organization. For webhooks and scripts. */
export async function twilioForOrgId(orgId: string): Promise<TwilioResolution> {
  const org = await platformDb.organization
    .findUnique({ where: { id: orgId }, select: SELECT })
    .catch(() => null);
  return resolve(org);
}

/** What settings shows about the connection, without exposing the token. */
export async function twilioConnectionStatus(orgId: string): Promise<{
  connected: boolean;
  accountSid: string | null;
  tokenHint: string | null;
  connectedAt: Date | null;
  /** Stored credentials that no longer decrypt — needs reconnecting. */
  unreadable: boolean;
  /** Falling back to Awer's own Twilio account. */
  usingPlatform: boolean;
  smsNumber: string | null;
}> {
  const org = await platformDb.organization.findUnique({
    where: { id: orgId },
    select: {
      twilioAccountSid: true,
      twilioAuthTokenEnc: true,
      twilioTokenHint: true,
      twilioConnectedAt: true,
      smsNumber: true,
    },
  });
  const hasOwn = Boolean(org?.twilioAccountSid && org?.twilioAuthTokenEnc);
  const unreadable = hasOwn && openSecret(org!.twilioAuthTokenEnc) === null;
  return {
    connected: hasOwn && !unreadable,
    accountSid: org?.twilioAccountSid ?? null,
    tokenHint: org?.twilioTokenHint ?? null,
    connectedAt: org?.twilioConnectedAt ?? null,
    unreadable,
    usingPlatform: !hasOwn && platformCreds() !== null,
    smsNumber: org?.smsNumber ?? null,
  };
}
