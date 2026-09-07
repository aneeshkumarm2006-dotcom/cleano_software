/**
 * The texting connector's precedence rules, proven against staging.
 *
 * The rule that matters: a workspace's own Twilio account wins, a workspace
 * without one falls back to the platform's, and a stored token that will not
 * decrypt falls back to NOTHING — sending a company's customers a text from a
 * stranger's number, or checking their webhooks against the wrong token, is
 * worse than refusing.
 *
 *   SECRETS_KEY=<key> DATABASE_URL=<staging> PLATFORM_DATABASE_URL=<staging elevated> \
 *   npx tsx scripts/verify-twilio-connector.ts
 */
import { PrismaClient } from "@prisma/client";

import { seal, hint } from "../src/lib/secret-box";
import { twilioForOrgId, twilioConnectionStatus } from "../src/lib/twilio-org";

const FAKE_SID = "AC00000000000000000000000000000001";
const FAKE_TOKEN = "staging_fake_auth_token_not_real_0001";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

async function main() {
  const platform = new PrismaClient({
    datasources: { db: { url: process.env.PLATFORM_DATABASE_URL! } },
  });
  const org = await platform.organization.findFirst({
    where: { slug: "teamcleano-demo" },
    select: { id: true, twilioAccountSid: true, twilioAuthTokenEnc: true, twilioTokenHint: true },
  });
  if (!org) throw new Error("demo org not found on staging");
  const original = {
    twilioAccountSid: org.twilioAccountSid,
    twilioAuthTokenEnc: org.twilioAuthTokenEnc,
    twilioTokenHint: org.twilioTokenHint,
  };

  try {
    // ── not connected → the platform account ────────────────────────────────
    console.log("\n— no workspace account —");
    await platform.organization.update({
      where: { id: org.id },
      data: { twilioAccountSid: null, twilioAuthTokenEnc: null, twilioTokenHint: null },
    });
    process.env.TWILIO_ACCOUNT_SID = "ACplatform000000000000000000000001";
    process.env.TWILIO_AUTH_TOKEN = "platform_token";
    let r = await twilioForOrgId(org.id);
    check("falls back to the platform account", r.ok && r.creds.source === "platform");

    console.log("\n— no workspace account, no platform account —");
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    r = await twilioForOrgId(org.id);
    check("reports not-configured", !r.ok && r.reason === "not-configured",
      JSON.stringify(r));

    // ── connected → their own account wins ──────────────────────────────────
    console.log("\n— workspace connected its own account —");
    await platform.organization.update({
      where: { id: org.id },
      data: {
        twilioAccountSid: FAKE_SID,
        twilioAuthTokenEnc: seal(FAKE_TOKEN),
        twilioTokenHint: hint(FAKE_TOKEN),
        twilioConnectedAt: new Date(),
      },
    });
    process.env.TWILIO_ACCOUNT_SID = "ACplatform000000000000000000000001";
    process.env.TWILIO_AUTH_TOKEN = "platform_token";
    r = await twilioForOrgId(org.id);
    check("their own account wins over the platform's", r.ok && r.creds.source === "workspace");
    check("the token decrypts back to what was stored",
      r.ok && r.creds.authToken === FAKE_TOKEN);
    check("the SID is theirs", r.ok && r.creds.accountSid === FAKE_SID);

    const status = await twilioConnectionStatus(org.id);
    check("settings reports connected", status.connected && !status.unreadable);
    check("settings shows a masked hint, never the token",
      status.tokenHint === hint(FAKE_TOKEN) && !status.tokenHint!.includes(FAKE_TOKEN.slice(0, 8)),
      status.tokenHint ?? "");

    // ── stored token no longer decrypts ─────────────────────────────────────
    console.log("\n— saved token can no longer be read —");
    await platform.organization.update({
      where: { id: org.id },
      data: { twilioAuthTokenEnc: "v1.bogus.bogus.bogus" },
    });
    r = await twilioForOrgId(org.id);
    check("refuses rather than falling back to the platform account",
      !r.ok && r.reason === "unreadable", JSON.stringify(r));
    const bad = await twilioConnectionStatus(org.id);
    check("settings says reconnect is needed", bad.unreadable && !bad.connected);
  } finally {
    await platform.organization.update({ where: { id: org.id }, data: original });
    check("staging restored to how it was found", true);
    await platform.$disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
