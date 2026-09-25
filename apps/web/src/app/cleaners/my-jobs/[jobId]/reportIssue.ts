"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireOrgId } from "@/lib/org";
import { actorFromSession } from "@/server/actor";
import { fireEffects } from "@/server/effects";
import { reportJobIssueFor } from "@/server/issues/issues";

/**
 * A cleaner tells the office something is wrong (Sept 3 fix list, item 1).
 *
 * Before this there was nowhere to put it. A cleaner standing outside a locked
 * door either phoned somebody or wrote a job note nobody was watching, and the
 * only trace afterwards was prose in a timeline with no owner and no state.
 *
 * The rules live in server/issues/issues.ts, shared with the phone.
 */
export async function reportJobIssue(input: {
  jobId: string;
  category: string;
  urgency: string;
  description: string;
  photoId?: string | null;
}): Promise<{ success: true; issueId: string } | { success: false; error: string }> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return { success: false, error: "Not authenticated" };
  }

  try {
    const actor = actorFromSession(
      session.user as { id: string; name?: string | null; email: string; role?: string | null },
      await requireOrgId(),
    );
    const result = await reportJobIssueFor(actor, {
      jobId: input.jobId,
      category: input.category,
      urgency: input.urgency,
      description: input.description,
      photoId: input.photoId,
      door: "web",
      now: new Date(),
    });
    if (!result.ok) return { success: false, error: result.message };

    // Fire-and-forget after the write, as before.
    fireEffects(result.effects);

    revalidatePath(`/cleaners/my-jobs/${input.jobId}`);
    // The admin job page renders the same rows server-side, so without this an
    // admin watching the job sees a stale timeline until a hard reload.
    revalidatePath(`/admin/jobs/${input.jobId}`);

    return { success: true, issueId: result.value.issueId };
  } catch (error) {
    console.error("Error reporting job issue:", error);
    return { success: false, error: "Failed to report the issue" };
  }
}
