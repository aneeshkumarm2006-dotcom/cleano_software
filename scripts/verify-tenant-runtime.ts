/**
 * Prove that code with no request still lands on the right tenant.
 *
 *   DATABASE_URL="$STAGING_DATABASE_URL" npx tsx scripts/verify-tenant-runtime.ts
 *
 * This is the part of the multi-tenant work with no type to check and no page to
 * look at. Cron jobs, webhooks and scripts announce their organization instead
 * of reading it from a host, and if that announcement did not actually reach the
 * query layer the failure would be silent: the queries would return nothing (RLS
 * failing closed) or, worse, the wrong company's rows.
 */
import { PrismaClient } from "@prisma/client";

import { db } from "../src/lib/org-db";
import { runAsOrg } from "../src/lib/org-context";
import { getOrgSlug, requireOrgId } from "../src/lib/org";
import { originForSlug } from "../src/lib/tenant";

/**
 * The control connection, used to work out what the answer SHOULD be.
 *
 * It has to be the elevated role. Pointing it at the restricted application role
 * makes every control query return nothing -- row-level security refuses a
 * connection with no organization set -- and the comparison then "fails" while
 * the code under test is behaving perfectly. Which is exactly what happened the
 * first time this script ran.
 */
const controlUrl = process.env.CONTROL_DATABASE_URL ?? process.env.DATABASE_URL;
const platform = new PrismaClient({ datasources: { db: { url: controlUrl } } });
let pass = 0,
  fail = 0;
const ok = (m: string) => {
  pass++;
  console.log("  ok    " + m);
};
const bad = (m: string, d: string) => {
  fail++;
  console.log("  FAIL  " + m + " — " + d);
};

(async () => {
  if (!(process.env.DATABASE_URL ?? "").includes("udgbixmlyqsoalvrjbgo")) {
    throw new Error("ABORT: not staging");
  }
  if (!(controlUrl ?? "").includes("udgbixmlyqsoalvrjbgo")) {
    throw new Error("ABORT: control connection is not staging");
  }
  // Prove the control connection can actually see across organizations, or every
  // comparison below is meaningless.
  if ((await platform.client.count()) === 0) {
    throw new Error(
      "control connection sees no clients at all — point CONTROL_DATABASE_URL at the elevated role",
    );
  }

  const orgs = await platform.organization.findMany({
    where: { status: "ACTIVE", slug: { not: "platform" } },
    select: { id: true, slug: true, name: true, timezone: true },
    orderBy: { slug: "asc" },
  });
  if (orgs.length < 2) {
    throw new Error(
      `need at least two seeded organizations to prove isolation, found ${orgs.length}`,
    );
  }
  const [a, b] = orgs;
  console.log(`\nUsing "${a.slug}" and "${b.slug}"\n`);

  console.log("THE ANNOUNCEMENT REACHES THE QUERY LAYER");
  await runAsOrg(a, async () => {
    (await getOrgSlug()) === a.slug
      ? ok("inside a context, the current slug is that organization")
      : bad("slug", await getOrgSlug());
    (await requireOrgId()) === a.id
      ? ok("and the id resolves without a request or a lookup")
      : bad("id", await requireOrgId());
  });

  console.log("\nEACH ORGANIZATION SEES ONLY ITS OWN ROWS");
  const counts: Record<string, number> = {};
  for (const o of [a, b]) {
    counts[o.slug] = await runAsOrg(o, () => db.client.count());
  }
  const trueA = await platform.client.count({ where: { organizationId: a.id, deletedAt: null } });
  const trueB = await platform.client.count({ where: { organizationId: b.id, deletedAt: null } });
  counts[a.slug] === trueA
    ? ok(`${a.slug} counted ${counts[a.slug]} clients, matching its own rows`)
    : bad(`${a.slug} count`, `${counts[a.slug]} vs ${trueA}`);
  counts[b.slug] === trueB
    ? ok(`${b.slug} counted ${counts[b.slug]} clients, matching its own rows`)
    : bad(`${b.slug} count`, `${counts[b.slug]} vs ${trueB}`);

  console.log("\nONE CANNOT REACH THE OTHER");
  const someoneOfB = await platform.client.findFirst({
    where: { organizationId: b.id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!someoneOfB) {
    bad("setup", `${b.slug} has no clients to attempt a cross-tenant read with`);
  } else {
    const leaked = await runAsOrg(a, () =>
      db.client.findFirst({ where: { id: someoneOfB.id } }),
    );
    leaked === null
      ? ok(`${a.slug} asked for one of ${b.slug}'s clients by id and got nothing`)
      : bad("CROSS-TENANT READ", `${a.slug} read "${leaked.name}"`);
  }

  console.log("\nCONTEXT DOES NOT LEAK BETWEEN ITERATIONS");
  const seen: string[] = [];
  for (const o of [a, b, a]) {
    seen.push(await runAsOrg(o, () => getOrgSlug()));
  }
  seen.join(",") === [a.slug, b.slug, a.slug].join(",")
    ? ok("a loop over organizations sees each one in turn, never the previous")
    : bad("sequence", seen.join(","));

  console.log("\nLINKS IN EMAILS ARE PER ORGANIZATION");
  const urlA = originForSlug(a.slug);
  const urlB = originForSlug(b.slug);
  urlA !== urlB
    ? ok(`different addresses: ${urlA} vs ${urlB}`)
    : bad("addresses identical", urlA);
  urlA.includes(a.slug)
    ? ok("each address contains its own workspace name")
    : bad("address", urlA);

  console.log("\nINBOUND TEXTS ROUTE BY THE NUMBER THEY ARRIVED ON");
  const probe = "+15550000199";
  await platform.organization.update({ where: { id: b.id }, data: { smsNumber: probe } });
  try {
    const { orgForInboundNumber } = await import("../src/lib/sms-sender");
    const found = await orgForInboundNumber(probe);
    found?.id === b.id
      ? ok(`a text to ${probe} resolves to ${b.slug}`)
      : bad("routing", found?.slug ?? "no match");
    const missing = await orgForInboundNumber("+15550000000");
    missing === null
      ? ok("a number nobody owns resolves to nothing, rather than a default")
      : bad("unowned number matched", missing.slug);
  } finally {
    await platform.organization.update({ where: { id: b.id }, data: { smsNumber: null } });
    ok("probe number cleared");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
})()
  .catch((e) => {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => platform.$disconnect());
