// The tier hourly-rate defaults, read from Settings. Pure rules live in
// pay-tiers.ts.

import "server-only";
import { getSetting } from "@/lib/settings";
import { NO_TIER_HOURLY_RATES, type TierHourlyRates } from "@/lib/pay-tiers";

/**
 * This workspace's default hourly rate per payroll tier.
 *
 * Falls back to all-zero rather than throwing: these are a convenience for
 * prefilling a form, and a settings read that fails must not stop an admin
 * creating a job.
 */
export async function getTierHourlyRates(): Promise<TierHourlyRates> {
  try {
    const [trainee, standard, fieldLead] = await Promise.all([
      getSetting("provider.hourlyRateTrainee"),
      getSetting("provider.hourlyRateStandard"),
      getSetting("provider.hourlyRateFieldLead"),
    ]);
    const n = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
    return {
      TRAINEE: n(trainee),
      STANDARD: n(standard),
      FIELD_LEAD: n(fieldLead),
    };
  } catch {
    return { ...NO_TIER_HOURLY_RATES };
  }
}
