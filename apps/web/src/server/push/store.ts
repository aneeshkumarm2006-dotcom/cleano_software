// The push store on the company's own client: every read and write is scoped
// to the announced company (org-db + RLS), so a push can only ever reach this
// company's registered phones.
import "server-only";

import { Prisma } from "@prisma/client";

import { requireOrgId } from "@/lib/org";
import { db } from "@/lib/org-db";

import type { PushStore } from "./core";

export const prismaPushStore: PushStore = {
  async devicesFor(userIds) {
    if (userIds.length === 0) return [];
    return db.pushDevice.findMany({
      // A switched-off or archived person's rows are removed when that
      // happens (lib/session-revocation.ts); this is the second lock.
      where: { userId: { in: [...userIds] }, user: { isActive: true, deletedAt: null } },
      select: { id: true, userId: true, token: true },
    });
  },

  async removeDevices(ids) {
    if (ids.length === 0) return;
    await db.pushDevice.deleteMany({ where: { id: { in: [...ids] } } });
  },

  async claimThrottle(userIds, key, windowMs, now) {
    if (userIds.length === 0) return [];
    const orgId = await requireOrgId();
    const cutoff = new Date(now.getTime() - windowMs);
    // One statement: a new row, or an old one moved forward, is a push; a row
    // inside the window is left alone and not returned.
    const rows = await db.$queryRaw<{ userId: string }[]>`
      INSERT INTO "PushThrottle" ("organizationId", "id", "userId", "key", "lastSentAt")
      SELECT ${orgId}, gen_random_uuid()::text, u, ${key}, ${now}
      FROM unnest(${[...userIds]}::text[]) AS u
      ON CONFLICT ("organizationId", "userId", "key")
      DO UPDATE SET "lastSentAt" = EXCLUDED."lastSentAt"
      WHERE "PushThrottle"."lastSentAt" <= ${cutoff}
      RETURNING "userId"`;
    return rows.map((r) => r.userId);
  },

  async claimReminder(jobId, startTime, userIds) {
    const claimed: string[] = [];
    for (const userId of new Set(userIds)) {
      try {
        await db.pushJobReminder.create({ data: { jobId, userId, startTime }, select: { id: true } });
        claimed.push(userId);
      } catch (e) {
        // Already sent for this job and start: the marker doing its job.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
        throw e;
      }
    }
    return claimed;
  },
};
