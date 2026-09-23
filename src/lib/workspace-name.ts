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

/** The platform. Not a cleaning company. */
export const PLATFORM_NAME = "Bookmops";

export async function workspaceName(): Promise<string> {
  // Context first: this also runs from crons and scripts, outside a request.
  const ctx = orgFromContext();

  const setting = await getSetting("general.businessName").catch(() => null);
  if (typeof setting === "string" && setting.trim()) return setting.trim();

  if (ctx?.name?.trim()) return ctx.name.trim();

  const org = await getCurrentOrg().catch(() => null);
  if (org?.name?.trim()) return org.name.trim();

  return PLATFORM_NAME;
}
