import type { Metadata } from "next";
import type { OrgPlan } from "@prisma/client";

import SplitShell, { BRAND_IMAGES } from "@/components/customer/SplitShell";
import AwerLogo from "@/components/AwerLogo";
import { PLANS, TRIAL_DAYS } from "@/lib/plans";

import SignupForm, { type PlanCard } from "./SignupForm";

export const metadata: Metadata = {
  title: "Start your workspace · Awer",
  description:
    "Scheduling, crew, customers and invoicing for cleaning companies. Thirty days free, no card.",
};

// Reads the live organization table to check whether an address is free, so
// there is nothing here worth prerendering.
export const dynamic = "force-dynamic";

/**
 * Where a new cleaning company starts.
 *
 * Built from the same PLANS definition that prices them, gates their features
 * and caps their cleaners — a pricing page that can drift from what is actually
 * enforced is a promise nobody kept.
 *
 * Reuses the sign-in page's shell and form controls rather than introducing a
 * second visual language for the same audience.
 */
export default async function GetStartedPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;

  const cards: PlanCard[] = (Object.keys(PLANS) as OrgPlan[]).map((key) => {
    const p = PLANS[key];
    return {
      key,
      label: p.label,
      price: p.monthlyUsd == null ? "Talk to us" : `$${p.monthlyUsd}`,
      per: p.monthlyUsd == null ? "" : "per month",
      cleaners: p.maxCleaners == null ? "Unlimited cleaners" : `Up to ${p.maxCleaners} cleaners`,
      highlights: p.highlights,
      selfServe: p.selfServe,
    };
  });

  // A plan can be pre-selected from the marketing page, but only one that can
  // actually be signed up for; anything else falls back to the first.
  const requested = (plan ?? "").toUpperCase();
  const initial =
    cards.find((c) => c.key === requested && c.selfServe)?.key ??
    cards.find((c) => c.selfServe)!.key;

  return (
    <SplitShell
      // Awer's own front door: its own mark, a neutral photo, and no
      // cleaning company's customer count. /admin-login.png is TeamCleano's
      // branded shot -- polo shirt and framed logo -- and belongs on their
      // workspace, not on the page where their competitors sign up.
      logo={<AwerLogo onDark />}
      footNote={null}
      image={BRAND_IMAGES.home}
      quoteHtml={"Every job, every<br/>cleaner, <em>one<br/>place.</em>"}
      quoteSub="Awer runs the scheduling, the crew, the customers and the invoicing for cleaning companies."
      topRightLabel="Sign in →"
      topRightHref="/sign-in"
      badge={`${TRIAL_DAYS} days free`}
    >
      <SignupForm plans={cards} trialDays={TRIAL_DAYS} initialPlan={initial} />
    </SplitShell>
  );
}
