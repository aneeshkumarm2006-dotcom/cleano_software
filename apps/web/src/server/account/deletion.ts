// "Delete my account" from Bookmops Pro (GET/POST /api/v1/me/deletion-request;
// App Store guideline 5.1.1(v)).
//
// A staff account is the employer's, and the company must keep pay and tax
// records by law, so nothing is deleted here: the person's request is
// recorded, and the office is told, once. The office then removes the account
// the way it always has (the web's employee page).
//
// One row per person (AccountDeletionRequest). Asking again while a request is
// PENDING answers with the first one's time and raises nothing: a retry past
// the idempotency record's life, a double tap, or a second phone never alerts
// the office twice. A request the office has already HANDLED is opened again.
import "server-only";

import { Prisma } from "@prisma/client";
import { DELETION_REASON_MAX, type DeletionRequestResponse, type DeletionRequestState } from "@bookmops/api/v1";

import { recordAdminNotification } from "@/lib/admin-notifications";
import { sendAdminStaffDeletionRequest } from "@/lib/email";
import { db } from "@/lib/org-db";

import type { Actor } from "../actor";
import { effect, type Effect } from "../effects";
import { failure, ok, type Result } from "../result";

const PENDING = "PENDING";

export async function deletionRequestFor(actor: Actor): Promise<Result<DeletionRequestState>> {
  const row = await db.accountDeletionRequest.findFirst({
    where: { userId: actor.userId },
    select: { status: true, requestedAt: true },
  });
  const pending = row?.status === PENDING;
  return ok({ pending, requestedAt: pending && row ? row.requestedAt.toISOString() : null });
}

export async function requestAccountDeletion(
  actor: Actor,
  input: { reason?: string; clientEventId: string; now: Date },
): Promise<Result<DeletionRequestResponse>> {
  const reason = input.reason?.trim() || null;
  if (reason && reason.length > DELETION_REASON_MAX) {
    return failure(400, "VALIDATION_FAILED", `Keep the reason under ${DELETION_REASON_MAX} characters.`);
  }

  const answer = (at: Date, effects: Effect[] = []) => ok({ requestedAt: at.toISOString() }, effects);
  const opened = (at: Date) => answer(at, officeTold(actor, reason, at));

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await db.accountDeletionRequest.findFirst({
      where: { userId: actor.userId },
      select: { id: true, status: true, requestedAt: true },
    });
    if (existing?.status === PENDING) return answer(existing.requestedAt);

    if (existing) {
      // Handled before: open it again. Conditional, so two requests racing
      // here re-open it once and only the one that did tells the office.
      const reopened = await db.accountDeletionRequest.updateMany({
        where: { id: existing.id, status: { not: PENDING } },
        data: {
          status: PENDING,
          reason,
          clientEventId: input.clientEventId,
          requestedAt: input.now,
          handledAt: null,
          handledById: null,
        },
      });
      if (reopened.count === 1) return opened(input.now);
      continue;
    }

    try {
      await db.accountDeletionRequest.create({
        data: { userId: actor.userId, reason, clientEventId: input.clientEventId, requestedAt: input.now },
        select: { id: true },
      });
      return opened(input.now);
    } catch (e) {
      // Someone else's request (another phone) made the row first: read it.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  return failure(409, "TRY_AGAIN", "That didn't go through. Try again.", true);
}

/** The office alert and the admins' email, after the response. */
function officeTold(actor: Actor, reason: string | null, at: Date): Effect[] {
  const name = actor.name?.trim() || actor.email;
  return [
    effect("account deletion request alert", () =>
      recordAdminNotification({
        key: "admin.account.staff_deletion_request",
        title: `${name} asked to delete their account`,
        body:
          `Sent from Bookmops Pro on ${at.toISOString().slice(0, 10)}. Nothing has been deleted yet.` +
          (reason ? ` Reason: ${reason}` : ""),
        href: `/admin/employees/${encodeURIComponent(actor.userId)}`,
        severity: "WARN",
      }),
    ),
    effect("account deletion request email", () =>
      sendAdminStaffDeletionRequest({ userId: actor.userId, name, email: actor.email, reason }),
    ),
  ];
}
