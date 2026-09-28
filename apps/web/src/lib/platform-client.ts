/**
 * The elevated (RLS-bypassing) Prisma client itself, with no guard attached.
 *
 * Import it from @/lib/platform-db, which pairs it with requirePlatformStaff().
 * It lives here, apart, only so that modules lib/auth depends on can reach it
 * without an import cycle (platform-db imports lib/auth): today that is
 * lib/shared-rate-limit.ts, whose counters are not tenant rows (see there).
 * Never import this into tenant-facing code.
 */
import { PrismaClient } from "@prisma/client";

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
