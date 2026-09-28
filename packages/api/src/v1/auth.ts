// Signing in from a phone (API_V1.md §2). These endpoints live on the
// PLATFORM host (useawer.com), not a company's: they are how the app finds
// which company, or companies, a person belongs to before it can talk to one.
import { z } from "zod";

/**
 * POST /api/v1/auth/workspaces  (platform host)
 *
 * The server must: check the password against the account in EACH company
 * where the email exists and return only those where it matches; run a
 * dummy password check when there is no account, so timing says nothing;
 * rate-limit per email and per address in a shared store; never return the
 * platform workspace or a suspended company. It creates no session.
 */
export const WorkspacesRequest = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});
export const Workspace = z.object({
  orgId: z.string(),
  name: z.string(),
  /** Always the canonical https://<slug>.useawer.com, whatever domain the company uses. */
  apiOrigin: z.url(),
});
export type Workspace = z.infer<typeof Workspace>;
export const WorkspacesResponse = z.object({ workspaces: z.array(Workspace) });
export type WorkspacesResponse = z.infer<typeof WorkspacesResponse>;

/**
 * POST /api/v1/auth/forgot-password  (platform host)
 *
 * Emails a reset link for every workspace the address belongs to. Always
 * answers 200 with the same body, so it reveals nothing about the address.
 * Rate-limited per email and per address.
 */
export const ForgotPasswordRequest = z.object({ email: z.email().max(254) });
export const ForgotPasswordResponse = z.object({ ok: z.literal(true) });

/**
 * GET /api/v1/meta  (any host, no session)
 *
 * The oldest build each app still supports, and the newest. Builds below the
 * minimum get 426 on every call and show a blocking "please update" screen.
 */
export const AppVersions = z.object({ minSupportedVersion: z.string(), latestVersion: z.string() });
export const MetaResponse = z.object({
  apps: z.object({ pro: AppVersions, customer: AppVersions }),
});
export type MetaResponse = z.infer<typeof MetaResponse>;
