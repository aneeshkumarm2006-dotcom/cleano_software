// Server-side tax rates — single source of truth for job/invoice tax math.
// Reads the admin-editable `tax.config` app setting (Settings → Taxes) and
// falls back to the statutory Quebec rates in src/lib/tax.ts.
//
// The PURE parts — computeJobTaxes, isJobTaxExempt, taxExemptReason, TaxRates
// and DEFAULT_TAX_RATES — live in ./tax (client-safe) and are re-exported here,
// so server code keeps importing from "@/lib/tax.server" while client display
// code can apply the identical rule. Only the DB read is server-only.
import "server-only";
import { db } from "@/lib/org-db";
import { DEFAULT_TAX_RATES, type TaxRates } from "@/lib/tax";

export {
  computeJobTaxes,
  isJobTaxExempt,
  taxExemptReason,
  DEFAULT_TAX_RATES,
} from "@/lib/tax";
export type { TaxRates } from "@/lib/tax";

export async function getTaxRates(): Promise<TaxRates> {
  try {
    const setting = await db.appSetting.findUnique({
      where: { key: "tax.config" },
    });
    const raw = (setting?.value ?? null) as {
      gstRate?: number;
      qstRate?: number;
    } | null;
    return {
      gstRate:
        typeof raw?.gstRate === "number" ? raw.gstRate : DEFAULT_TAX_RATES.gstRate,
      qstRate:
        typeof raw?.qstRate === "number" ? raw.qstRate : DEFAULT_TAX_RATES.qstRate,
    };
  } catch {
    // Fail safe: never block a save because the settings read failed.
    return { ...DEFAULT_TAX_RATES };
  }
}
