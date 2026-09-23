// What to call this workspace in front of a human.
//
// One place, because the answer was previously typed out in dozens: the browser
// tab said "Cleano", the PDF invoice header said "Cleano", the sign-in page
// said "Cleano", and the settings billing section said "Bookmops". Two of those
// are a tenant's name and two are the platform's, and neither is right
// everywhere.
//
// The order is the same everywhere it is asked:
//   1. `general.businessName` — what the admin typed in Settings
//   2. the Organization row's own name
//   3. "Bookmops" — the platform, used only where there IS no workspace: the
//      front door, the console, a request that never resolved a tenant.
//
// Never falls back to a customer's name. That is the bug this exists to close.

import "server-only";
import { getSetting } from "@/lib/settings";
import { getCurrentOrg } from "@/lib/org";
import { orgFromContext } from "@/lib/org-context";
import { PLATFORM_ORG_SLUG } from "@/lib/tenant";

/** The platform. Not a cleaning company. */
export const PLATFORM_NAME = "Bookmops";

export async function workspaceName(): Promise<string> {
  // Context first: this also runs from crons and scripts, outside a request.
  const ctx = orgFromContext();

  // The platform's own host is not a cleaning company, whatever its
  // Organization row happens to be called. That row is named "Awer", so
  // without this the marketing page at /welcome would have been titled for it
  // — caught by verify-marketing-page, which asserts the opposite.
  const org = await getCurrentOrg().catch(() => null);
  if (ctx?.slug === PLATFORM_ORG_SLUG || org?.slug === PLATFORM_ORG_SLUG) {
    return PLATFORM_NAME;
  }

  const setting = await getSetting("general.businessName").catch(() => null);
  if (typeof setting === "string" && setting.trim()) return setting.trim();

  if (ctx?.name?.trim()) return ctx.name.trim();
  if (org?.name?.trim()) return org.name.trim();

  return PLATFORM_NAME;
}
