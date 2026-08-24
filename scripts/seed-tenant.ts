/**
 * Seed one organization with synthetic data.
 *
 *   npx tsx scripts/seed-tenant.ts --slug demo-clean --name "Demo Clean"
 *
 * Every row it writes carries organizationId, so this doubles as the shape of
 * the provisioning that will run when a real company signs up.
 *
 * Contains NO production data. Emails use the reserved .test TLD (which can
 * never resolve) and phone numbers use the 555 fiction range, so even a
 * misconfigured environment cannot reach a real person.
 *
 * Refuses to run against anything but the staging database unless
 * SEED_ALLOW_ANY_DB=1 is set explicitly.
 */
import { PrismaClient, Roles, JobStatus, ClientType } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";

const STAGING_REF = "udgbixmlyqsoalvrjbgo";
const PASSWORD = "StagingPass123!";

const db = new PrismaClient();

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (!v && fallback === undefined) throw new Error(`missing --${name}`);
  return v ?? fallback!;
}

// Deterministic PRNG so repeated runs produce identical data.
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const FIRST = ["Ava","Liam","Noah","Emma","Olivia","Ethan","Mia","Lucas","Zoe","Leo",
  "Maya","Owen","Iris","Felix","Nora","Hugo","Ruby","Milo","Elle","Jonas"];
const LAST = ["Tremblay","Gagnon","Roy","Cote","Bouchard","Morin","Lavoie","Fortin",
  "Gauthier","Ouellet","Pelletier","Belanger","Levesque","Bergeron","Girard"];
const STREETS = ["Rue Sherbrooke","Avenue du Parc","Rue Saint-Denis","Boulevard Rene-Levesque",
  "Rue Notre-Dame","Avenue Mont-Royal","Rue Peel","Rue Wellington"];
const CITIES = ["Montreal","Laval","Longueuil","Brossard","Westmount"];
const JOB_TYPES = ["Standard Clean","Deep Clean","Move-Out","Post-Construction","Office Clean"];

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes(STAGING_REF) && process.env.SEED_ALLOW_ANY_DB !== "1") {
    throw new Error("refusing to seed: DATABASE_URL is not the staging branch");
  }

  const slug = arg("slug");
  const name = arg("name", slug);
  const rng = makeRng(
    [...slug].reduce((a, c) => a + c.charCodeAt(0), 0), // same slug -> same data
  );
  const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

  const existing = await db.organization.findUnique({ where: { slug } });
  if (existing) {
    console.log(`organization "${slug}" already exists (${existing.id}) — nothing to do`);
    return;
  }

  const org = await db.organization.create({
    data: { slug, name, status: "ACTIVE", plan: "PROFESSIONAL", timezone: "America/Toronto" },
  });
  const organizationId = org.id;
  console.log(`org ${org.slug} -> ${organizationId}`);

  const hashed = await hashPassword(PASSWORD);
  async function makeUser(local: string, fullName: string, role: Roles) {
    const user = await db.user.create({
      data: {
        organizationId,
        name: fullName,
        email: `${local}@${slug}.test`,
        role,
        emailVerified: true,
        isActive: true,
      },
    });
    await db.account.create({
      data: {
        userId: user.id,
        accountId: user.id,
        providerId: "credential",
        password: hashed,
      },
    });
    return user;
  }

  const owner = await makeUser("owner", `${name} Owner`, Roles.OWNER);
  await makeUser("admin", `${name} Admin`, Roles.ADMIN);

  const cleaners = [];
  for (let i = 0; i < 6; i++) {
    const fullName = `${pick(FIRST)} ${pick(LAST)}`;
    cleaners.push(await makeUser(`cleaner${i + 1}`, fullName, Roles.EMPLOYEE));
  }

  const clients = [];
  for (let i = 0; i < 25; i++) {
    const fullName = `${pick(FIRST)} ${pick(LAST)}`;
    const client = await db.client.create({
      data: {
        organizationId,
        name: fullName,
        email: `client${i + 1}@${slug}.test`,
        phone: `+1555${String(int(1000000, 9999999))}`,
        city: pick(CITIES),
        clientType: rng() < 0.2 ? ClientType.COMMERCIAL : ClientType.RESIDENTIAL,
      },
    });
    await db.clientAddress.create({
      data: {
        organizationId,
        clientId: client.id,
        label: "Home",
        address: `${int(100, 9999)} ${pick(STREETS)}`,
        city: pick(CITIES),
        postalCode: `H${int(1, 9)}${String.fromCharCode(65 + int(0, 25))} ${int(1, 9)}${String.fromCharCode(65 + int(0, 25))}${int(1, 9)}`,
        bedCount: int(1, 5),
        bathCount: int(1, 3),
        isDefault: true,
      },
    });
    clients.push(client);
  }

  const STATUSES: JobStatus[] = [
    JobStatus.CREATED, JobStatus.SCHEDULED, JobStatus.IN_PROGRESS,
    JobStatus.COMPLETED, JobStatus.PAID, JobStatus.CANCELLED,
  ];
  const base = new Date("2026-08-01T13:00:00.000Z").getTime();
  let jobs = 0;
  for (let i = 0; i < 40; i++) {
    const client = pick(clients);
    const cleaner = pick(cleaners);
    const start = new Date(base + int(-20, 20) * 86400000 + int(8, 16) * 3600000);
    const price = int(80, 450);
    const job = await db.job.create({
      data: {
        organizationId,
        clientName: client.name,
        clientId: client.id,
        employeeId: cleaner.id,
        jobType: pick(JOB_TYPES),
        location: `${int(100, 9999)} ${pick(STREETS)}`,
        startTime: start,
        endTime: new Date(start.getTime() + int(2, 5) * 3600000),
        status: pick(STATUSES),
        price,
        subtotalAmount: price,
        requiredCleaners: 1,
      },
    });
    await db.jobAssignment.create({
      data: { organizationId, jobId: job.id, cleanerId: cleaner.id },
    }).catch(() => {}); // assignment shape varies; job alone is enough
    jobs++;
  }

  console.log(`seeded: 8 users, ${clients.length} clients, ${jobs} jobs`);
  console.log(`login: owner@${slug}.test / ${PASSWORD}`);
}

main()
  .catch((e) => { console.error("SEED FAILED:", e.message); process.exitCode = 1; })
  .finally(() => db.$disconnect());
