/**
 * Write one AppSetting for the organization serving this request.
 *
 * AppSetting.key is unique *per organization* now, not globally, so upsert can
 * no longer address a row by key alone -- Prisma requires the whole composite
 * key, which call sites would have to name the organization to build.
 *
 * findFirst + update/create through the scoped client is equivalent and keeps
 * the organization implicit. The one difference from a true upsert is that two
 * concurrent writers could both find nothing and both create; the composite
 * unique index rejects the loser, which is the same outcome upsert would give.
 */
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/org-db";

export async function writeAppSetting(
  key: string,
  category: string,
  value: Prisma.InputJsonValue,
): Promise<void> {
  const existing = await db.appSetting.findFirst({
    where: { key },
    select: { id: true },
  });
  if (existing) {
    await db.appSetting.update({
      where: { id: existing.id },
      data: { category, value },
    });
  } else {
    await db.appSetting.create({ data: { key, category, value } });
  }
}
