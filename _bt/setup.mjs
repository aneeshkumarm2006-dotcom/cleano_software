// Creates the three isolated logins the browser tests run as.
//
// Why real signup over a direct DB insert: better-auth owns the password
// hashing (scrypt, its own params). Writing an Account row by hand means
// guessing that format, and a wrong guess fails at login with an error that
// looks exactly like a broken feature. Posting to the running server's own
// signup endpoint makes the hash correct by construction.
//
// Every row created here is recorded in manifest.jsonl before the next one
// is attempted, so a crash halfway through still leaves a cleanable trail.
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { record, MARKER, BT_DIR } from "./lib/manifest.mjs";

const BASE = process.env.BT_BASE_URL ?? "http://localhost:3001";
const PASSWORD = "BtTest!2026pw";
const db = new PrismaClient();

/** Roles the suite needs. `role` is the Roles enum value set after signup —
 *  better-auth's own signup always lands on the schema default (EMPLOYEE). */
const ACCOUNTS = [
  { key: "admin",    email: `bttest-admin@cleano-bt.local`,    name: `${MARKER} Admin`,    role: "OWNER" },
  { key: "cleaner",  email: `bttest-cleaner@cleano-bt.local`,  name: `${MARKER} Cleaner`,  role: "EMPLOYEE" },
  { key: "customer", email: `bttest-customer@cleano-bt.local`, name: `${MARKER} Customer`, role: "CLIENT" },
];

async function signUp({ email, name }) {
  const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, name }),
  });
  const text = await res.text();
  if (!res.ok) {
    // A re-run hits "user already exists" — fine, we adopt the existing row.
    if (/exist/i.test(text)) return { existed: true };
    throw new Error(`signup ${email} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return { existed: false };
}

async function main() {
  const out = { baseUrl: BASE, password: PASSWORD, accounts: {} };

  for (const acct of ACCOUNTS) {
    const before = await db.user.findUnique({ where: { email: acct.email }, select: { id: true } });
    if (!before) {
      await signUp(acct);
    }

    const user = await db.user.findUnique({ where: { email: acct.email }, select: { id: true } });
    if (!user) throw new Error(`signup reported success but no User row for ${acct.email}`);

    if (!before) {
      // Record the User first: Account/Session rows cascade from it, so the
      // User id alone is enough to clean the whole auth graph up.
      record("User", user.id, "setup");
    }

    // better-auth cannot set our Roles enum, so promote after the fact.
    // emailVerified is forced true — the verification mail is neutered, so a
    // cleaner would otherwise be stuck at an unverifiable gate.
    await db.user.update({
      where: { id: user.id },
      data: { role: acct.role, emailVerified: true, isActive: true, mustChangePassword: false },
    });

    out.accounts[acct.key] = { email: acct.email, password: PASSWORD, role: acct.role, userId: user.id };
    console.log(`  ${acct.key.padEnd(9)} ${acct.email}  role=${acct.role}  ${before ? "(adopted)" : "(created)"}`);
  }

  // The customer portal reads a Client row, not the User row.
  const customerUserId = out.accounts.customer.userId;
  let client = await db.client.findFirst({ where: { userId: customerUserId }, select: { id: true } });
  if (!client) {
    client = await db.client.create({
      data: {
        name: `${MARKER} Customer`,
        email: out.accounts.customer.email,
        userId: customerUserId,
        phone: "+15550100001",
      },
      select: { id: true },
    });
    record("Client", client.id, "setup");
  }
  out.accounts.customer.clientId = client.id;
  console.log(`  client    ${client.id}`);

  writeFileSync(join(BT_DIR, "accounts.json"), JSON.stringify(out, null, 2));
  console.log(`\nWrote _bt/accounts.json`);
}

main()
  .catch((e) => { console.error("SETUP FAILED:", e.message); process.exitCode = 1; })
  .finally(() => db.$disconnect());
