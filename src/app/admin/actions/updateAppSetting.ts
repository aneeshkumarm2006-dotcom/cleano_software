"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
import { revalidatePath } from "next/cache";
import { writeAppSetting } from "@/lib/app-setting-write";
import {
  isRegisteredSetting,
  writeSetting,
  invalidateSetting,
} from "@/lib/settings";
import { platformDb } from "@/lib/platform-db";
import { requireOrgId } from "@/lib/org";
import { isValidTimeZone } from "@/lib/timezone";

/** The one setting that also has to land on the Organization row. */
const TIMEZONE_KEY = "general.timezone";

interface UpdateAppSettingParams {
  key: string;
  category: string;
  value: unknown;
}

/**
 * What the admin is told when a save fails for a reason the registry did not
 * already describe.
 *
 * Every settings tab renders `res.error` inline and none of them throw, so this
 * string is the whole of what the admin gets to act on — and "Failed to update
 * setting" told them nothing: not which of the nine settings a multi-write tab
 * had just posted, not whether to retry, not what to quote to support. Naming
 * the key costs nothing (it is already on screen as a field) and turns a dead
 * end into a report anyone can follow up.
 */
function saveFailureMessage(key: string, error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  // Prisma's connection/timeout family. Retrying genuinely is the right advice.
  if (code === "P1001" || code === "P1002" || code === "P1008") {
    return `Couldn't reach the database while saving "${key}". Nothing was changed — try again in a moment.`;
  }
  return `Couldn't save "${key}". Nothing was changed. If this keeps happening, quote the setting name to support.`;
}

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" as const };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { error: "Not authorized" as const };
  }
  return { session };
}

export async function updateAppSetting(params: UpdateAppSettingParams) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    const { key, category, value } = params;
    if (!key || !category) {
      return { success: false, error: "Key and category are required" };
    }

    // The workspace clock. Two settings used to claim this job and only one of
    // them did it: `general.timezone` is the control the admin has, and its own
    // help text calls it "the source of truth for date and time handling" —
    // but every date in the app is formatted from `Organization.timezone`,
    // which is set once at workspace creation and never again. So an admin
    // could pick their timezone, be told it saved, and watch nothing move.
    //
    // Saving it here writes BOTH, so there is one control and one source of
    // truth (Sept 17, item 6).
    if (key === TIMEZONE_KEY) {
      if (!isValidTimeZone(value)) {
        return {
          success: false,
          error: `"${String(value)}" is not a timezone this app can use. Pick one from the list.`,
        };
      }
      const orgId = await requireOrgId();
      // platformDb, the same way an admin saves their Stripe or Twilio
      // credentials: the Organization row is a fact ABOUT the workspace and
      // sits outside the tenant-scoped tables.
      await platformDb.organization.update({
        where: { id: orgId },
        data: { timezone: value },
      });
    }

    // Registry-governed settings: validate + audit through the spine.
    if (isRegisteredSetting(key)) {
      const user = guard.session.user as {
        id?: string;
        name?: string;
        email?: string;
      };
      const res = await writeSetting(key, value, {
        id: user.id ?? null,
        label: user.name ?? user.email ?? null,
      });
      if (!res.success) return { success: false, error: res.error };
      revalidatePath("/admin/settings");
      return { success: true };
    }

    // Legacy / unregistered settings: existing passthrough behavior.
    await writeAppSetting(key, category, value as never);

    await invalidateSetting(key); // keyed per organization; keeps spine reads fresh
    revalidatePath("/admin/settings");
    return { success: true };
  } catch (error) {
    console.error(`Error updating app setting "${params.key}":`, error);
    return { success: false, error: saveFailureMessage(params.key, error) };
  }
}

export async function deleteAppSetting(key: string) {
  try {
    const guard = await requireAdmin();
    if ("error" in guard) return { success: false, error: guard.error };

    // key is unique per organization now, so deleteMany (which the scoped
    // client filters) replaces a delete addressed by key alone.
    await db.appSetting.deleteMany({ where: { key } });
    revalidatePath("/admin/settings");
    return { success: true };
  } catch (error) {
    // P2025 = "record to delete does not exist". The setting is already gone,
    // which is the state the caller wanted; reporting it as a failure sends an
    // admin chasing a problem that isn't there.
    if ((error as { code?: string } | null)?.code === "P2025") {
      revalidatePath("/admin/settings");
      return { success: true };
    }
    console.error(`Error deleting app setting "${key}":`, error);
    return {
      success: false,
      error: `Couldn't remove "${key}". Nothing was changed.`,
    };
  }
}
