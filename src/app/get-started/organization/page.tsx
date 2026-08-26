import type { Metadata } from "next";

import SplitShell from "@/components/customer/SplitShell";
import { PLANS } from "@/lib/plans";

import RequestForm from "./RequestForm";

export const metadata: Metadata = {
  title: "Organization plan · Awer",
  description:
    "For cleaning companies above twenty cleaners. Tell us how you work and we will price it.",
};

export const dynamic = "force-dynamic";

/**
 * Where the Organization tier is asked for.
 *
 * It is a separate page rather than a fourth card on the signup form because it
 * ends somewhere else: signup ends in a working workspace, this ends in a
 * conversation. Putting both behind one button would make one of them lie.
 */
export default function OrganizationRequestPage() {
  const pro = PLANS.PROFESSIONAL.maxCleaners;

  return (
    <SplitShell
      image="/admin-login.png"
      quoteHtml={"Bigger operations<br/>need a <em>real<br/>conversation.</em>"}
      quoteSub={`Above ${pro} cleaners the price depends on how you work, so we would rather talk than guess.`}
      topRightLabel="Start a free trial →"
      topRightHref="/get-started"
      badge="Organization"
    >
      <RequestForm />
    </SplitShell>
  );
}
