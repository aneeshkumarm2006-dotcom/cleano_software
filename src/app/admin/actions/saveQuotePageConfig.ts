"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { writeSetting } from "@/lib/settings";
import { QUOTE_PAGE_CONFIG_KEY } from "@/lib/quote-page-config";

/**
 * Save the public quote page's copy + field config (item 18).
 *
 * A dedicated action rather than the generic `updateAppSetting` for one
 * reason: that action revalidates `/admin/settings`, and this editor lives on
 * `/admin/quotes` and publishes to `/quote`. Saving through it would leave the
 * public page serving the previous config from the router cache — the admin
 * would edit a label, reload /quote, and see the old one, which reads as "the
 * editor doesn't work".
 *
 * Validation and the audit row come from the settings spine, same as every
 * other registered setting.
 */
export async function saveQuotePageConfig(value: unknown) {
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user as
    | { id?: string; name?: string; email?: string; role?: string }
    | undefined;
  if (!user?.id) return { success: false, error: "Not authenticated" };
  if (user.role !== "OWNER" && user.role !== "ADMIN") {
    return { success: false, error: "Not authorized" };
  }

  const res = await writeSetting(QUOTE_PAGE_CONFIG_KEY, value, {
    id: user.id,
    label: user.name ?? user.email ?? null,
  });
  if (!res.success) return { success: false, error: res.error };

  revalidatePath("/quote");
  revalidatePath("/admin/quotes");
  return { success: true };
}
