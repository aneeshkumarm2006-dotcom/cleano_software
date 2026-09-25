// Exactly-once for retried phone mutations (API_V1.md §6).
//
// One IdempotencyRecord per (company, person, key):
//   - the first request claims the key (IN_FLIGHT), runs, and stores its
//     answer (DONE);
//   - a retry with the same body gets the stored answer back and fires no
//     effects -- no second email, no second strike;
//   - the same key with a different body is refused, 422;
//   - a key whose first request is still running answers 409, retryable.
//
// The scope is enforced twice: the unique index is on all three columns, and
// every read and write here goes through the organization-scoped client under
// row-level security.
import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/org-db";

import { V1Error } from "./http";

export { canonicalJson, requestHash } from "./request-hash";

/** How long an answer is kept: longer than any correction window. */
export const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** A first request still IN_FLIGHT after this is taken to have died. */
export const IN_FLIGHT_STALE_MS = 2 * 60 * 1000;

const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;

export function isValidKey(key: string | null): key is string {
  return !!key && KEY_RE.test(key);
}

export type Claim =
  | { kind: "fresh"; recordId: string }
  | { kind: "replay"; statusCode: number; body: unknown };

/**
 * Claim `key` for this request, or find out what already happened to it.
 * Throws the 409 / 422 refusals as V1Errors.
 */
export async function claimKey(args: {
  userId: string;
  key: string;
  route: string;
  hash: string;
  now: Date;
}): Promise<Claim> {
  const expiresAt = new Date(args.now.getTime() + IDEMPOTENCY_TTL_MS);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const created = await db.idempotencyRecord.create({
        data: {
          userId: args.userId,
          key: args.key,
          route: args.route,
          requestHash: args.hash,
          state: "IN_FLIGHT",
          expiresAt,
        },
        select: { id: true },
      });
      return { kind: "fresh", recordId: created.id };
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") throw e;
    }

    const existing = await db.idempotencyRecord.findFirst({
      where: { userId: args.userId, key: args.key },
      select: {
        id: true,
        requestHash: true,
        state: true,
        statusCode: true,
        responseBody: true,
        expiresAt: true,
        updatedAt: true,
      },
    });
    // Gone between the insert and the read: try the insert once more.
    if (!existing) continue;

    if (existing.expiresAt.getTime() <= args.now.getTime()) {
      // Expired: the key is free again.
      await db.idempotencyRecord.deleteMany({ where: { id: existing.id } });
      continue;
    }

    if (existing.requestHash !== args.hash) {
      throw new V1Error(
        422,
        "IDEMPOTENCY_KEY_REUSED",
        "This request was already sent with different details, so it wasn't applied again.",
      );
    }

    if (existing.state === "DONE" && existing.statusCode) {
      return { kind: "replay", statusCode: existing.statusCode, body: existing.responseBody };
    }

    // IN_FLIGHT. Still running, or its request died without finishing.
    if (args.now.getTime() - existing.updatedAt.getTime() < IN_FLIGHT_STALE_MS) {
      throw new V1Error(409, "IN_FLIGHT", "This is still being saved. It will be tried again shortly.", true);
    }
    // Taken over: claimed again by this request, compare-and-set on the
    // timestamp so two retries can't both take it.
    const taken = await db.idempotencyRecord.updateMany({
      where: { id: existing.id, state: "IN_FLIGHT", updatedAt: existing.updatedAt },
      data: { updatedAt: args.now },
    });
    if (taken.count === 1) return { kind: "fresh", recordId: existing.id };
    throw new V1Error(409, "IN_FLIGHT", "This is still being saved. It will be tried again shortly.", true);
  }

  throw new V1Error(409, "IN_FLIGHT", "This is still being saved. It will be tried again shortly.", true);
}

/** Store the final answer, so a retry gets exactly this back. */
export async function completeKey(recordId: string, statusCode: number, body: unknown): Promise<void> {
  await db.idempotencyRecord.updateMany({
    where: { id: recordId },
    data: {
      state: "DONE",
      statusCode,
      responseBody: body === undefined ? Prisma.JsonNull : (body as Prisma.InputJsonValue),
    },
  });
}

/** Free the key: the request failed in a way a retry should be allowed to fix. */
export async function releaseKey(recordId: string): Promise<void> {
  await db.idempotencyRecord.deleteMany({ where: { id: recordId } });
}
