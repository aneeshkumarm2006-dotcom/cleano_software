"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isCleanerRole } from "@/lib/role-routing";

export default async function signOut() {
  // Capture the role before the session is destroyed so we can send each
  // audience back to its own login door.
  const session = await auth.api.getSession({ headers: await headers() });
  const role = (session?.user as { role?: string } | undefined)?.role;

  await auth.api.signOut({
    headers: await headers(),
  });

  redirect(isCleanerRole(role) ? "/cleanos/login" : "/sign-in");
}
