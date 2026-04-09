"use server";

import { prisma } from "@/lib/prisma";

/**
 * One-time migration: deduplicates existing clientName strings into Client
 * records and back-fills clientId on all Job rows. Safe to run multiple times
 * (skips names that already have a Client record).
 */
export async function migrateClients(): Promise<{
  created: number;
  updated: number;
}> {
  // Gather all distinct clientName values from Job rows that have no clientId
  const unmigrated = await prisma.job.findMany({
    where: { clientId: null },
    select: { clientName: true },
    distinct: ["clientName"],
  });

  if (unmigrated.length === 0) {
    return { created: 0, updated: 0 };
  }

  let created = 0;
  let updated = 0;

  await prisma.$transaction(async (tx) => {
    for (const { clientName } of unmigrated) {
      const trimmed = clientName.trim();
      if (!trimmed) continue;

      // Find existing Client by name or create a new one
      let client = await tx.client.findFirst({
        where: { name: trimmed },
      });

      if (!client) {
        client = await tx.client.create({
          data: { name: trimmed },
        });
        created++;
      }

      // Back-fill clientId on all matching Job rows
      const { count } = await tx.job.updateMany({
        where: { clientName: trimmed, clientId: null },
        data: { clientId: client.id },
      });

      updated += count;
    }
  });

  return { created, updated };
}
