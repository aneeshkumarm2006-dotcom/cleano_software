import { PrismaClient } from "@prisma/client";
import { provisionOrganization, ProvisioningError, findFreeSlug, slugify } from "../src/lib/provisioning";
import { TRIAL_DAYS } from "../src/lib/plans";
const db = new PrismaClient();
let pass=0, fail=0;
const ok=(m:string)=>{pass++;console.log("  ok    "+m)};
const bad=(m:string,d:string)=>{fail++;console.log("  FAIL  "+m+" — "+d)};

async function wipe(slug: string) {
  const o = await db.organization.findUnique({ where: { slug } });
  if (!o) return;
  await db.account.deleteMany({ where: { userId: { in: (await db.user.findMany({ where: { organizationId: o.id }, select: { id: true } })).map(u=>u.id) } } });
  await db.user.deleteMany({ where: { organizationId: o.id } });
  await db.subscription.deleteMany({ where: { organizationId: o.id } });
  await db.organization.delete({ where: { id: o.id } });
}

(async () => {
  if (!(process.env.DATABASE_URL ?? "").includes("udgbixmlyqsoalvrjbgo")) throw new Error("ABORT: not staging");
  await wipe("sparkle-clean"); await wipe("sparkle-clean-2");

  console.log("\nHAPPY PATH");
  const r = await provisionOrganization({
    slug: "Sparkle Clean", companyName: "Sparkle Clean Inc",
    ownerName: "Dana Fortin", ownerEmail: "Dana@Sparkle.TEST",
    password: "TrialPass123!", plan: "PROFESSIONAL",
  });
  r.slug === "sparkle-clean" ? ok(`company name became the address "${r.slug}"`) : bad("slug", r.slug);

  const org = await db.organization.findUniqueOrThrow({ where: { id: r.organizationId }, include: { subscription: true } });
  org.status === "ACTIVE" ? ok("workspace is usable immediately") : bad("status", org.status);
  org.subscription?.status === "TRIALING" ? ok("subscription starts on trial") : bad("sub", String(org.subscription?.status));
  const days = Math.round(((org.subscription!.trialEndsAt!.getTime() - Date.now())/86400000));
  days === TRIAL_DAYS ? ok(`trial runs ${days} days`) : bad("trial length", `${days} days`);
  org.nextJobNumber === 1 ? ok("job numbering starts at #1") : bad("numbering", String(org.nextJobNumber));

  const owner = await db.user.findFirstOrThrow({ where: { organizationId: r.organizationId } });
  owner.role === "OWNER" ? ok("first user is the owner") : bad("role", owner.role);
  owner.email === "dana@sparkle.test" ? ok("email normalised to lowercase") : bad("email", owner.email);
  (await db.account.count({ where: { userId: owner.id } })) === 1 ? ok("owner can sign in (credential stored)") : bad("account","missing");

  console.log("\nREFUSALS");
  try { await provisionOrganization({ slug:"sparkle-clean", companyName:"X", ownerName:"Y", ownerEmail:"y@x.test", password:"p", plan:"STARTER" }); bad("duplicate slug","allowed"); }
  catch (e) { (e as ProvisioningError).code === "slug-taken" ? ok("a taken address is refused") : bad("dup", String(e)); }

  try { await provisionOrganization({ slug:"platform", companyName:"X", ownerName:"Y", ownerEmail:"y@x.test", password:"p", plan:"STARTER" }); bad("reserved slug","allowed"); }
  catch (e) { (e as ProvisioningError).code === "slug-invalid" ? ok("a reserved address is refused") : bad("reserved", String(e)); }

  try { await provisionOrganization({ slug:"big-co", companyName:"X", ownerName:"Y", ownerEmail:"y@x.test", password:"p", plan:"ORGANIZATION" }); bad("enterprise self-serve","allowed"); }
  catch (e) { (e as ProvisioningError).code === "plan-not-self-serve" ? ok("the quoted tier cannot be self-served") : bad("plan", String(e)); }

  console.log("\nCOLLISION HANDLING");
  const alt = await findFreeSlug("Sparkle Clean");
  alt === "sparkle-clean-2" ? ok(`offers "${alt}" when the first choice is taken`) : bad("free slug", alt);
  slugify("Émile & Sons  Cleaning!!") === "emile-sons-cleaning" ? ok("accents and punctuation handled") : bad("slugify", slugify("Émile & Sons  Cleaning!!"));

  await wipe("sparkle-clean");
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail===0?0:1;
})().catch(e=>{console.error("ERROR:",e.message);process.exitCode=1}).finally(()=>db.$disconnect());
