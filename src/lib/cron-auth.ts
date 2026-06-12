import { timingSafeEqual } from "crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Constant-time check of the cron `Authorization: Bearer <secret>` header.
 * Returns false if CRON_SECRET is unset (fail closed).
 */
export function isAuthorizedCron(authorization: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return safeEqual(authorization ?? "", `Bearer ${secret}`);
}
