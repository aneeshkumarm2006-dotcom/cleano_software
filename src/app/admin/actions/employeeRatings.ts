"use server";

// Admin-entered ratings, and corrections to existing ones.
//
// Sept 17 list, item 13. Two of the PDF's asks were already here and one was
// not. Customer reviews reach the cleaner's profile (Sept 10, item 11), and a
// rating can be pulled out of the average with a reason and put back
// (`setRatingExcluded`, which is the PDF's "deleted ratings ... removed from
// the average or archived in logs" — kept, not destroyed). What was missing is
// an admin ADDING a rating with a real reason, and CORRECTING one that is
// wrong.
//
// `setEmployeeRating` did technically add one, but it wrote the fixed string
// "Admin manual override" as the note, so the rating history could show that an
// admin had intervened and never why. That is the half of the complaint that
// matters: a score nobody can explain is a score nobody trusts.

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/org-db";
import { isAdminRole } from "@/lib/role-routing";
import { logActivity } from "@/lib/activity-log";
import { RATING_MIN, RATING_MAX } from "@/lib/policy";
import { normaliseAdminRating, RATING_NOTE_MAX } from "@/lib/rating-history";
import { recalculateMultiplier } from "./recalculateMultiplier";

type Result = { success: true } | { success: false; error: string };

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false as const, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (!isAdminRole(role)) return { ok: false as const, error: "Not authorized" };
  return { ok: true as const, user: session.user as { id: string; name?: string | null } };
}

/**
 * Add a rating by hand, with the reason for it.
 *
 * The note is REQUIRED. An admin rating moves a cleaner's pay tier, and one
 * with no reason attached is indistinguishable, three months later, from a
 * mis-tap — which is exactly the kind of row the exclusion feature exists to
 * clean up after. Asking for a sentence at the point of entry is cheaper than
 * reconstructing it afterwards.
 */
export async function addAdminRating(input: {
  employeeId: string;
  rating: number | string;
  note: string;
}): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return { success: false, error: gate.error };

  const parsed = normaliseAdminRating(input.rating, RATING_MIN, RATING_MAX);
  if (!parsed.ok) return { success: false, error: parsed.error };

  const note = String(input.note ?? "").trim().slice(0, RATING_NOTE_MAX);
  if (note.length < 3) {
    return {
      success: false,
      error: "Say why. This note is the only record of the reason once the score has moved.",
    };
  }

  try {
    const employee = await db.user.findFirst({
      where: { id: input.employeeId, role: { not: "CLIENT" }, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!employee) return { success: false, error: "Cleaner not found" };

    await db.employeeRating.create({
      data: {
        employeeId: employee.id,
        rating: parsed.value,
        notes: note,
        ratedBy: gate.user.id,
        source: "ADMIN",
      },
    });

    // The average just moved, so the pay tier derived from it has to move with
    // it — otherwise the cleaner's money reflects a score nobody is looking at.
    await recalculateMultiplier({ employeeId: employee.id });

    await logActivity({
      category: "ADMIN",
      action: "employee.rating.added",
      status: "SUCCESS",
      targetType: "User",
      targetId: employee.id,
      message: `${gate.user.name ?? "An admin"} added a ${parsed.value}-star rating for ${employee.name}: ${note}`,
    }).catch(() => {});

    revalidatePath(`/admin/employees/${employee.id}`);
    return { success: true };
  } catch (e) {
    console.error("addAdminRating", e);
    return { success: false, error: "Couldn't save that rating. Nothing was changed." };
  }
}

/**
 * Correct a rating that is wrong.
 *
 * Any rating, including a customer's: the PDF asks for "edit or delete
 * incorrect ratings" without qualification, and a customer who meant to give
 * five and hit one is the commonest reason this is needed.
 *
 * The edit is STAMPED (`editedAt`) rather than silent, and the old value goes
 * into the activity log, because a score that can be changed without trace is
 * worth less than one that cannot be changed at all.
 */
export async function editRating(input: {
  ratingId: string;
  rating: number | string;
  note?: string;
}): Promise<Result> {
  const gate = await requireAdmin();
  if (!gate.ok) return { success: false, error: gate.error };

  const parsed = normaliseAdminRating(input.rating, RATING_MIN, RATING_MAX);
  if (!parsed.ok) return { success: false, error: parsed.error };

  try {
    const existing = await db.employeeRating.findUnique({
      where: { id: input.ratingId },
      select: {
        id: true,
        employeeId: true,
        rating: true,
        notes: true,
        jobId: true,
        employee: { select: { name: true } },
      },
    });
    if (!existing) return { success: false, error: "Rating not found" };

    const note =
      input.note === undefined
        ? existing.notes
        : String(input.note).trim().slice(0, RATING_NOTE_MAX) || null;

    const unchanged = existing.rating === parsed.value && existing.notes === note;
    if (unchanged) return { success: true };

    await db.employeeRating.update({
      where: { id: existing.id },
      data: { rating: parsed.value, notes: note, editedAt: new Date() },
    });

    await recalculateMultiplier({ employeeId: existing.employeeId });

    await logActivity({
      category: "ADMIN",
      action: "employee.rating.edited",
      status: "SUCCESS",
      targetType: "User",
      targetId: existing.employeeId,
      message: `${gate.user.name ?? "An admin"} changed a rating for ${existing.employee?.name ?? "a cleaner"} from ${existing.rating} to ${parsed.value} stars${note ? ` — ${note}` : ""}.`,
    }).catch(() => {});

    // Alongside everything else that happened on that booking, when there is
    // one to put it on.
    if (existing.jobId) {
      await db.jobLog
        .create({
          data: {
            jobId: existing.jobId,
            userId: gate.user.id,
            action: "UPDATED",
            field: "rating",
            oldValue: String(existing.rating),
            newValue: String(parsed.value),
            description: `Rating corrected by ${gate.user.name ?? "an admin"}.`,
          },
        })
        .catch(() => {});
    }

    revalidatePath(`/admin/employees/${existing.employeeId}`);
    return { success: true };
  } catch (e) {
    console.error("editRating", e);
    return { success: false, error: "Couldn't change that rating. Nothing was changed." };
  }
}
