import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { db } from "@/lib/org-db";
import { auth } from "@/lib/auth";
import { logActivity } from "@/lib/activity-log";
import { notifyAdmins } from "@/lib/admin-alerts";
import {
  homeForRole,
  isClientRole,
  isCleanerRole,
  isApplicantRole,
  isAdminRole,
} from "@/lib/role-routing";

// Role-aware landing after sign-in. Each login "door" only accepts its own
// audience; a wrong-role account is signed out and bounced to the correct
// login with an explanatory ?error.
//
// Query params:
//   ?from=portal    → customer portal door — CLIENT accounts only.
//   ?from=cleaner   → cleaner door — EMPLOYEE accounts only.
//   ?from=applicant → applicant portal door — APPLICANT accounts only (D4).
//   (no from)       → staff door (/sign-in) — admin/staff roles only.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const from = url.searchParams.get("from");

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.redirect(`${baseUrl}/sign-in`);
  }

  const role = (session.user as { role?: string }).role;
  const email = (session.user as { email?: string }).email ?? null;
  const doorLabel =
    from === "portal" ? "portal" : from === "cleaner" ? "cleaner" : from === "applicant" ? "applicant" : "staff";

  // Credentials were valid (failed logins never reach this route), but the
  // account may still be the wrong audience for this door. Log the *outcome*
  // — access granted vs. denied — not just the authentication, so the audit
  // trail shows who was turned away.
  async function granted(path: string) {
    await logActivity({
      category: "AUTH",
      action: "login",
      status: "SUCCESS",
      actorId: session!.user.id,
      actorLabel: email,
      message: `Signed in via ${doorLabel} door (role: ${role ?? "?"})`,
    });

    // First login = never seen before. Stamp lastSeenAt and, for imported
    // (temp-password) accounts, alert admins that the account was activated.
    try {
      const u = await db.user.findUnique({
        where: { id: session!.user.id },
        select: { lastSeenAt: true, mustChangePassword: true, name: true },
      });
      if (u && u.lastSeenAt == null) {
        await db.user.update({
          where: { id: session!.user.id },
          data: { lastSeenAt: new Date() },
        });
        await logActivity({
          category: "AUTH",
          action: "first_login",
          status: "SUCCESS",
          actorId: session!.user.id,
          actorLabel: email,
          message: `First login (${doorLabel} door, role: ${role ?? "?"}).`,
        });
        if (u.mustChangePassword) {
          const label = isCleanerRole(role) ? "Cleaner" : "Customer";
          await notifyAdmins({
            title: `First login — ${u.name ?? email}`,
            message: `${label} ${u.name ?? email} <${email}> logged in for the first time (imported account activated).`,
            relatedId: session!.user.id,
            relatedType: "User",
          });
        }
      }
    } catch (e) {
      console.error("first-login hook", e);
    }

    const res = NextResponse.redirect(`${baseUrl}${path}`);
    // Remember which login door this account belongs to (outlives the
    // session) so an expired session in the installed homescreen app is sent
    // back to the RIGHT login page instead of the customer one (item 14).
    const door = isCleanerRole(role)
      ? "cleaner"
      : isApplicantRole(role)
        ? "applicant"
        : isAdminRole(role)
          ? "staff"
          : "portal";
    res.cookies.set("cleano_door", door, {
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
      httpOnly: true,
    });
    return res;
  }

  // Sign the wrong-role account out so it doesn't sit in a half-state, record
  // the denial, then bounce to the right login.
  async function bounce(path: string, reason: string) {
    await logActivity({
      category: "AUTH",
      action: "login_denied",
      status: "FAILED",
      actorId: session!.user.id,
      actorLabel: email,
      message: `Access denied at ${doorLabel} door — ${reason} (role: ${role ?? "?"})`,
    });
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
      return bounce(`/login?error=staff_account`, "not a customer account");
    }
    return granted(homeForRole(role));
  }

  // Cleaner door — employees only.
  if (from === "cleaner") {
    if (!isCleanerRole(role)) {
      return bounce(`/cleanos/login?error=not_cleaner`, "not a cleaner account");
    }
    return granted(homeForRole(role));
  }

  // Applicant portal door — restricted APPLICANT accounts only (D4).
  if (from === "applicant") {
    if (!isApplicantRole(role)) {
      return bounce(`/applicant-login?error=not_applicant`, "not an applicant account");
    }
    return granted(homeForRole(role));
  }

  // Staff door (default, /sign-in) — admin/staff roles only. Other roles are
  // sent to their own login.
  if (!isAdminRole(role)) {
    if (isCleanerRole(role)) {
      return bounce(`/cleanos/login?error=use_cleaner_login`, "cleaner should use the cleaner login");
    }
    if (isClientRole(role)) {
      return bounce(`/login?error=staff_account`, "customer should use the portal login");
    }
    if (isApplicantRole(role)) {
      return bounce(`/applicant-login?error=use_applicant_login`, "applicant should use the applicant login");
    }
    return bounce(`/sign-in?error=no_access`, "role has no staff access");
  }
  return granted(homeForRole(role));
}
