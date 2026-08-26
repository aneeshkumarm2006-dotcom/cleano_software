/**
 * The database client for Awer's own console, and the guard that gates it.
 *
 * This is the ONLY client permitted to read across organizations. It connects
 * with credentials that bypass row-level security, because a console that
 * cannot see every customer is not a console.
 *
 * That makes it the most dangerous object in the codebase, so it is deliberately
 * awkward to reach: a separate import, a separate connection, and every entry
 * point goes through requirePlatformStaff(), which fails closed.
 *
 * Never import this into tenant-facing code. Tenant code uses @/lib/org-db,
 * which cannot leave its organization.
 */
import { PrismaClient } from "@prisma/client";

import { getCachedSession } from "@/lib/auth";
import { db as tenantScopedDb } from "@/lib/org-db";

declare global {
  // eslint-disable-next-line no-var
  var __platformDb: PrismaClient | undefined;
}

function make(): PrismaClient {
  // Falls back to DATABASE_URL so local development works without extra setup.
  // In a deployed environment PLATFORM_DATABASE_URL is the elevated connection
  // and DATABASE_URL is the restricted one; if they are the same, the console
  // simply sees nothing rather than seeing everything.
  const url = process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL;
  return new PrismaClient({ datasources: { db: { url } } });
}

export const platformDb: PrismaClient =
  global.__platformDb ?? (global.__platformDb = make());

export type PlatformStaff = {
  id: string;
  email: string;
  name: string;
  platformRole: "SUPPORT" | "ADMIN" | "OWNER";
};

/**
 * The signed-in Awer staff member, or null.
 *
 * Reads through the tenant-scoped client on purpose: staff sign in to the
 * platform workspace like anyone else, and the ordinary session rules apply to
 * them. Being staff is a property of the user, not a way around the session.
 */
export async function getPlatformStaff(): Promise<PlatformStaff | null> {
  const session = await getCachedSession();
  if (!session?.user?.id) return null;

  const user = await tenantScopedDb.user.findFirst({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, platformRole: true, isActive: true },
  });
  if (!user || !user.isActive || !user.platformRole) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    platformRole: user.platformRole,
  };
}

export class NotPlatformStaffError extends Error {
  constructor() {
    super("Not Awer staff.");
    this.name = "NotPlatformStaffError";
  }
}

/**
 * Gate for every console entry point.
 *
 * `minimum` is checked against the ordering SUPPORT < ADMIN < OWNER, so a
 * read-only support account cannot suspend an account by finding an unguarded
 * route.
 */
const RANK = { SUPPORT: 1, ADMIN: 2, OWNER: 3 } as const;

export async function requirePlatformStaff(
  minimum: keyof typeof RANK = "SUPPORT",
): Promise<PlatformStaff> {
  const staff = await getPlatformStaff();
  if (!staff) throw new NotPlatformStaffError();
  if (RANK[staff.platformRole] < RANK[minimum]) throw new NotPlatformStaffError();
  return staff;
}

/**
 * Write down what staff did. Impersonation means Awer can see live customer
 * data, so every action against an account leaves a record.
 */
export async function recordPlatformAction(
  staff: PlatformStaff,
  action: string,
  target?: { id?: string; slug?: string },
  detail?: Record<string, unknown>,
): Promise<void> {
  await platformDb.platformAuditLog.create({
    data: {
      actorId: staff.id,
      actorEmail: staff.email,
      action,
      targetOrgId: target?.id ?? null,
      targetOrgSlug: target?.slug ?? null,
      detail: (detail ?? {}) as never,
    },
  });
}
