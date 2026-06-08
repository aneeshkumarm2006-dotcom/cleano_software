"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { applyStrike } from "@/lib/strikes";
import type { StrikeReason } from "@prisma/client";

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { error: "Not authenticated" as const };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN") {
    return { error: "Not authorized" as const };
  }
  return { session };
}

/** Admin manually adds a strike. A note is required. */
export async function addStrikeManual(input: {
  cleanerId: string;
  reasonCode: StrikeReason;
  note: string;
}) {
  const auth = await requireAdmin();
  if ("error" in auth) return { success: false, error: auth.error };

  if (!input.cleanerId) return { success: false, error: "Missing cleaner" };
  if (!input.note?.trim()) return { success: false, error: "A note is required" };

  await applyStrike({
    cleanerId: input.cleanerId,
    reasonCode: input.reasonCode,
    isAuto: false,
    appliedById: auth.session.user.id,
    adminNote: input.note.trim(),
  });

  revalidatePath(`/employees/${input.cleanerId}`);
  return { success: true };
}

/**
 * Admin removes, excuses, or reactivates an existing strike. A note is
 * required for the audit trail. "remove" voids a wrongly-applied strike;
 * "excuse" forgives it (e.g. approved notice); both stop it counting.
 */
export async function updateStrike(input: {
  strikeId: string;
  action: "remove" | "excuse" | "reactivate";
  note: string;
}) {
  const auth = await requireAdmin();
  if ("error" in auth) return { success: false, error: auth.error };

  if (!input.strikeId) return { success: false, error: "Missing strike" };
  if (!input.note?.trim()) return { success: false, error: "A note is required" };

  const strike = await db.cleanerStrike.findUnique({
    where: { id: input.strikeId },
    select: { id: true, cleanerId: true, adminNote: true },
  });
  if (!strike) return { success: false, error: "Strike not found" };

  const stamp = `[${input.action}] ${input.note.trim()}`;
  const adminNote = strike.adminNote ? `${strike.adminNote}\n${stamp}` : stamp;

  const data =
    input.action === "remove"
      ? { status: "REMOVED" as const, adminNote }
      : input.action === "excuse"
      ? {
          status: "EXCUSED" as const,
          excusedById: auth.session.user.id,
          excusedAt: new Date(),
          adminNote,
        }
      : { status: "ACTIVE" as const, excusedById: null, excusedAt: null, adminNote };

  await db.cleanerStrike.update({ where: { id: input.strikeId }, data });

  revalidatePath(`/employees/${strike.cleanerId}`);
  return { success: true };
}
