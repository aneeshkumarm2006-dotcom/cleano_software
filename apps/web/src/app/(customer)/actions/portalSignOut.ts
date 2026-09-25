"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

// Customer sign-out: returns to the customer portal entry, not the admin /sign-in.
export default async function portalSignOut() {
  await auth.api.signOut({
    headers: await headers(),
  });

  redirect("/login");
}
