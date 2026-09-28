// POST /api/v1/auth/forgot-password — email a reset link for every company
// the address belongs to (API_V1.md §2). Platform host. Always answers
// { ok: true }, whatever happened, so it reveals nothing about the address.
import { ForgotPasswordRequest, ForgotPasswordResponse } from "@bookmops/api/v1";

import { forgotPasswordEffects } from "@/server/auth/forgot-password";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "platform",
    access: "public",
    body: ForgotPasswordRequest,
    response: ForgotPasswordResponse,
    ipLimit: { name: "forgot", max: 30, windowMs: 60_000, shared: true },
  },
  async (ctx) => {
    const effects = await forgotPasswordEffects(ctx.body.email, ctx.ip).catch((e) => {
      console.error("v1 forgot-password", e);
      return [];
    });
    return { ok: true, value: { ok: true as const }, effects };
  },
);
