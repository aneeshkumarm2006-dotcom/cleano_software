"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import type { ChecklistItemStatus } from "@prisma/client";

import { actorFromSession } from "@/server/actor";
import { updateChecklistItemFor } from "@/server/checklist/checklist";
import { revalidateAfterChecklist } from "@/server/clock/revalidate";
import { fireEffects } from "@/server/effects";

interface UpdateChecklistItemInput {
  itemId: string;
  status?: ChecklistItemStatus;
  notes?: string | null;
}

/**
 * Tick, untick or annotate a checklist item. The rule — who may, what is
 * written, and the "checklist completed" email to the office — lives in
 * server/checklist/checklist.ts, shared with the phone's
 * PUT /api/v1/jobs/:id/checklist/:itemId. This action is the web's front door
 * onto it and answers exactly as it always has.
 */
export async function updateChecklistItem(input: UpdateChecklistItemInput) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { success: false as const, error: "Not authenticated" };
  }

  try {
    const result = await updateChecklistItemFor(
      actorFromSession(session.user as { id: string; name?: string | null; email: string; role?: string | null }),
      { itemId: input.itemId, status: input.status, notes: input.notes, now: new Date() },
    );
    if (!result.ok) return { success: false as const, error: result.message };
    fireEffects(result.effects);

    // Both the job page and the clock screen show this checklist. The clock
    // screen is a route of its own — without it, it kept serving the payload
    // it was rendered with, so its progress bar and its clock-out gate
    // disagreed with the boxes the cleaner had just ticked.
    revalidateAfterChecklist(result.value.jobId);
    return { success: true as const };
  } catch (error) {
    console.error("Error updating checklist item:", error);
    return { success: false as const, error: "Failed to update item" };
  }
}
