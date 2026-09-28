// POST /api/v1/me/password — choose a new password. The current one is
// always required; every other session ends; this device stays signed in.
import { ChangePasswordRequest, ChangePasswordResponse } from "@bookmops/api/v1";

import { changeOwnPassword } from "@/server/account/password";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: "anyStaff",
    allowPendingPasswordChange: true,
    body: ChangePasswordRequest,
    response: ChangePasswordResponse,
    // Guessing the current password from a stolen session is slow on purpose.
    limit: { name: "password", max: 5, windowMs: 15 * 60_000 },
  },
  (ctx) =>
    changeOwnPassword(ctx.actor, {
      currentPassword: ctx.body.currentPassword,
      newPassword: ctx.body.newPassword,
      keepSessionToken: ctx.session.token,
    }),
);
