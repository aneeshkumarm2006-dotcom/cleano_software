import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  homeForRole,
  isClientRole,
  isCleanerRole,
  isAdminRole,
} from "@/lib/role-routing";

// Role-aware landing after sign-in. Each login "door" only accepts its own
// audience; a wrong-role account is signed out and bounced to the correct
// login with an explanatory ?error.
//
// Query params:
//   ?from=portal   → customer portal door — CLIENT accounts only.
//   ?from=cleaner  → cleaner door — EMPLOYEE accounts only.
//   (no from)      → staff door (/sign-in) — admin/staff roles only.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const from = url.searchParams.get("from");

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.redirect(`${baseUrl}/sign-in`);
  }

  const role = (session.user as { role?: string }).role;

  // Sign the wrong-role account out so it doesn't sit in a half-state, then
  // bounce to the right login.
  async function bounce(path: string) {
    try {
      await auth.api.signOut({ headers: await headers() });
    } catch {
      // Ignore — worst case the user stays signed in but in the wrong area.
    }
    return NextResponse.redirect(`${baseUrl}${path}`);
  }

  // Customer portal door — clients only.
  if (from === "portal") {
    if (!isClientRole(role)) {
      return bounce(`/portal/login?error=staff_account`);
    }
    return NextResponse.redirect(`${baseUrl}${homeForRole(role)}`);
  }

  // Cleaner door — employees only.
  if (from === "cleaner") {
    if (!isCleanerRole(role)) {
      return bounce(`/cleanos/login?error=not_cleaner`);
    }
    return NextResponse.redirect(`${baseUrl}${homeForRole(role)}`);
  }

  // Staff door (default, /sign-in) — admin/staff roles only. Other roles are
  // sent to their own login.
  if (!isAdminRole(role)) {
    if (isCleanerRole(role)) {
      return bounce(`/cleanos/login?error=use_cleaner_login`);
    }
    if (isClientRole(role)) {
      return bounce(`/portal/login?error=staff_account`);
    }
    return bounce(`/sign-in?error=no_access`);
  }
  return NextResponse.redirect(`${baseUrl}${homeForRole(role)}`);
}
