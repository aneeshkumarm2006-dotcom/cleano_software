/**
 * Whose bank account does a payment land in?
 *
 *   DATABASE_URL="$LOCAL_URL" npx tsx scripts/verify-stripe-isolation.ts
 *
 * One STRIPE_SECRET_KEY used to serve the whole platform, and no call site knew
 * which company it was acting for. Nothing would have crashed. The second
 * company's customers would simply have paid the first company's Stripe
 * account, and it would have looked like everything worked.
 *
 * That failure is invisible to every other kind of test — the request succeeds,
 * the booking is created, the customer gets a receipt. So it gets its own suite,
 * and the assertion that matters most is the NEGATIVE one: a workspace with no
 * credentials must resolve to nothing at all, never to the environment's key.
 */
import { PrismaClient } from "@prisma/client";

import { assertSafeTarget } from "../src/lib/safe-target";
import { seal, open, hint, canStoreSecrets } from "../src/lib/secret-box";

const db = new PrismaClient();
let pass = 0,
  fail = 0;
const ok = (m: string) => {
  pass++;
  console.log(`  ok    ${m}`);
};
const bad = (m: string, d: string) => {
  fail++;
  console.log(`  FAIL  ${m} — ${d}`);
};

const FAKE_A = "sk_test_workspaceAkey000000000000";
const FAKE_ENV = "sk_test_environmentkey0000000000";

(async () => {
  try {
    assertSafeTarget(process.env.DATABASE_URL, "test");
  } catch (e) {
    console.log(`SKIP verify-stripe-isolation — ${(e as Error).message}`);
    return;
  }

  console.log("\nENCRYPTION AT REST");
  process.env.SECRETS_KEY ||= "0".repeat(64);
  canStoreSecrets() ? ok("a key is available to encrypt with") : bad("SECRETS_KEY", "unusable");

  const sealed = seal(FAKE_A);
  !sealed.includes(FAKE_A)
    ? ok("the stored form does not contain the key")
    : bad("seal", "the secret is readable in the stored value");
  open(sealed) === FAKE_A ? ok("it decrypts back to the same key") : bad("open", "round trip failed");

  // GCM authenticates as well as encrypts: a row edited in the database must
  // fail to open rather than open into something else.
  const parts = sealed.split(".");
  const tampered = [parts[0], parts[1], parts[2], Buffer.from("tampered").toString("base64url")].join(".");
  open(tampered) === null ? ok("a tampered value refuses to decrypt") : bad("tamper", "it decrypted anyway");

  const realKey = process.env.SECRETS_KEY;
  process.env.SECRETS_KEY = "f".repeat(64);
  open(sealed) === null
    ? ok("a value sealed with a different key refuses to decrypt")
    : bad("wrong key", "it decrypted anyway");
  process.env.SECRETS_KEY = realKey;

  hint(FAKE_A) === `••••${FAKE_A.slice(-4)}`
    ? ok("the hint shows four characters and no more")
    : bad("hint", hint(FAKE_A));

  console.log("\nWHICH ACCOUNT EACH WORKSPACE USES");
  const orgs = await db.organization.findMany({
    where: { slug: { not: "platform" } },
    orderBy: { slug: "asc" },
    select: { id: true, slug: true, stripeSecretKeyEnc: true, stripePublishableKey: true },
  });
  if (orgs.length < 2) throw new Error(`need two workspaces; found ${orgs.length}`);
  const [A, B] = orgs;

  const saved = { a: A.stripeSecretKeyEnc, b: B.stripeSecretKeyEnc, pub: A.stripePublishableKey };
  process.env.STRIPE_SECRET_KEY = FAKE_ENV;
  process.env.STRIPE_ENV_ORG_SLUG = B.slug; // the environment's key belongs to B

  try {
    await db.organization.update({
      where: { id: A.id },
      data: { stripeSecretKeyEnc: seal(FAKE_A), stripePublishableKey: "pk_test_a" },
    });
    await db.organization.update({ where: { id: B.id }, data: { stripeSecretKeyEnc: null } });

    const { stripeForOrgId } = await import("../src/lib/stripe-org");

    const a = await stripeForOrgId(A.id);
    a.ok && a.source === "workspace"
      ? ok(`${A.slug} uses its OWN saved account`)
      : bad(`${A.slug}`, JSON.stringify(a.ok ? a.source : a.reason));

    const b = await stripeForOrgId(B.id);
    b.ok && b.source === "environment"
      ? ok(`${B.slug} is the workspace the environment's key belongs to, and uses it`)
      : bad(`${B.slug}`, JSON.stringify(b.ok ? b.source : b.reason));

    a.ok && b.ok && a.stripe !== b.stripe
      ? ok("the two workspaces hold two DIFFERENT Stripe clients")
      : bad("shared client", "both workspaces resolved to the same Stripe client");

    // THE ASSERTION THIS SUITE EXISTS FOR.
    //
    // Point the environment's key at a workspace that is not B, so B is now an
    // ordinary company with no account of its own — exactly the position every
    // new signup is in on their first day. No re-import is needed: the resolver
    // reads the environment on each call, not once at module load.
    process.env.STRIPE_ENV_ORG_SLUG = "some-other-company";
    const orphan = await stripeForOrgId(B.id);
    !orphan.ok && orphan.reason === "not-configured"
      ? ok("a workspace with no account of its own resolves to NOTHING, not to the environment's key")
      : bad(
          "fallback",
          orphan.ok
            ? `it fell back to the ${orphan.source} account — this is money in the wrong bank`
            : orphan.reason,
        );

    // A key that will not decrypt must also refuse, not fall through.
    await db.organization.update({
      where: { id: A.id },
      data: { stripeSecretKeyEnc: "v1.aaaa.bbbb.cccc" },
    });
    const broken = await stripeForOrgId(A.id);
    !broken.ok && broken.reason === "unreadable"
      ? ok("an unreadable saved key refuses, rather than falling back to someone else's")
      : bad("unreadable", broken.ok ? `used the ${broken.source} account` : broken.reason);
  } finally {
    await db.organization.update({
      where: { id: A.id },
      data: { stripeSecretKeyEnc: saved.a, stripePublishableKey: saved.pub },
    });
    await db.organization.update({ where: { id: B.id }, data: { stripeSecretKeyEnc: saved.b } });
  }

  console.log("\nTHE OLD SHARED CLIENT IS DISARMED");
  const { stripe } = await import("../src/lib/stripe");
  try {
    void (stripe as unknown as Record<string, unknown>).paymentIntents;
    bad("shared client", "it can still be reached, so a call site could use it by accident");
  } catch (e) {
    /organization|company|stripe-org/i.test((e as Error).message)
      ? ok("reaching for it throws, and the message says what to use instead")
      : bad("shared client", (e as Error).message.slice(0, 80));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
})()
  .catch((e) => {
    console.error("ERROR:", e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
