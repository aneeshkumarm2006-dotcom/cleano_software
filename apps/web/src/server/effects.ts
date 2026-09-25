// Side effects a service asks for, rather than performs (API_V1.md §5).
//
// Emails, notifications and the like are not part of the answer to a request,
// and they must not run twice when a request is replayed. So a service returns
// them as a list and each front door decides how to flush it:
//
//   - the web's server actions fire them at once and do not wait, which is
//     exactly what those actions did before the logic moved into a service;
//   - the v1 wrapper runs them with after(), once the response has gone, and
//     never for a replayed idempotency key.
import "server-only";

import { runAsOrg, type OrgContext } from "@/lib/org-context";

export interface Effect {
  /** Names the effect in the logs when it fails. Never carries personal data. */
  label: string;
  run: () => Promise<unknown>;
}

export const effect = (label: string, run: () => Promise<unknown>): Effect => ({ label, run });

/** Fire and forget, as the web actions always have. */
export function fireEffects(effects: readonly Effect[]): void {
  for (const e of effects) {
    e.run().catch((err) => console.error(e.label, err));
  }
}

/**
 * Run every effect in order, inside the organization's context when there is
 * one. Used from after(), where the request's own context is gone. A platform
 * endpoint has no organization; its effects set their own (see
 * server/auth/forgot-password.ts).
 */
export async function flushEffects(org: OrgContext | null, effects: readonly Effect[]): Promise<void> {
  if (effects.length === 0) return;
  const runAll = async () => {
    for (const e of effects) {
      try {
        await e.run();
      } catch (err) {
        console.error(e.label, err);
      }
    }
  };
  await (org ? runAsOrg(org, runAll) : runAll());
}
