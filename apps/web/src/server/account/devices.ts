// Push notification devices (POST /api/v1/devices, …/devices/unregister).
//
// A token is stored against the caller and their company only. A token
// already registered here by someone else moves to the caller: a phone that
// changed hands belongs to its newest signed-in person. Unregistering removes
// only the caller's own row, and is a no-op otherwise.
import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/org-db";

import type { Actor } from "../actor";
import { ok, type Result } from "../result";

export async function registerDevice(
  actor: Actor,
  input: { token: string; platform: "ios" | "android"; appVersion: string },
): Promise<Result<{ id: string }>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await db.pushDevice.findFirst({ where: { token: input.token }, select: { id: true } });
    if (existing) {
      const row = await db.pushDevice.update({
        where: { id: existing.id },
        data: { userId: actor.userId, platform: input.platform, appVersion: input.appVersion },
        select: { id: true },
      });
      return ok({ id: row.id });
    }
    try {
      const row = await db.pushDevice.create({
        data: { userId: actor.userId, token: input.token, platform: input.platform, appVersion: input.appVersion },
        select: { id: true },
      });
      return ok({ id: row.id });
    } catch (e) {
      // Registered by a parallel request between the read and the insert.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  throw new Error("registerDevice: could not settle a concurrent registration");
}

export async function unregisterDevice(actor: Actor, token: string): Promise<Result<{ ok: true }>> {
  await db.pushDevice.deleteMany({ where: { token, userId: actor.userId } });
  return ok({ ok: true as const });
}
