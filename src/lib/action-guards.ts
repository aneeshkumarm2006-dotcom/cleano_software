import { auth } from "@/lib/auth";
import { headers } from "next/headers";

// Server-action authorization helpers. Server actions are independently callable
// RPC endpoints — every sensitive one must authorize on its own (middleware does
// not cover them). These return a discriminated result instead of redirecting.

export interface Actor {
  userId?: string;
  role?: string;
}

export async function getActor(): Promise<Actor> {
  const session = await auth.api.getSession({ headers: await headers() });
  const u = session?.user as { id?: string; role?: string } | undefined;
  return { userId: u?.id, role: u?.role };
}

/** OWNER/ADMIN only — for sensitive mutations (products, migrations, alerts). */
export async function requireOwnerAdmin(): Promise<
  { ok: true; userId: string; role: string } | { ok: false; error: string }
> {
  const { userId, role } = await getActor();
  if (!userId) return { ok: false, error: "Not authenticated" };
  if (role !== "OWNER" && role !== "ADMIN") {
    return { ok: false, error: "Not authorized" };
  }
  return { ok: true, userId, role };
}
