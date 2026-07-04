// Server-side tax rates — single source of truth for job/invoice tax math.
// Reads the admin-editable `tax.config` app setting (Settings → Taxes) and
// falls back to the statutory Quebec rates hardcoded in src/lib/tax.ts (which
// stays client-safe for the booking flow). Rates are PERCENTAGES (5 / 9.975),
// matching how `tax.config` stores them.
import "server-only";
import { db } from "@/db";
import { GST_RATE, QST_RATE } from "@/lib/tax";

export interface TaxRates {
  gstRate: number;
  qstRate: number;
}

export const DEFAULT_TAX_RATES: TaxRates = {
  gstRate: GST_RATE * 100,
  qstRate: QST_RATE * 100,
};

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * GST/QST breakdown on a pre-tax subtotal (price − discount). Cash jobs are
 * tax-exempt: zero tax, total = subtotal.
 */
export function computeJobTaxes(
  subtotal: number,
  rates: TaxRates,
  isCashJob: boolean
): {
  subtotalAmount: number;
  gstAmount: number;
  qstAmount: number;
  totalAmount: number;
} {
  const sub = round2(Math.max(0, subtotal));
  if (isCashJob) {
    return { subtotalAmount: sub, gstAmount: 0, qstAmount: 0, totalAmount: sub };
  }
  const gstAmount = round2((sub * rates.gstRate) / 100);
  const qstAmount = round2((sub * rates.qstRate) / 100);
  return {
    subtotalAmount: sub,
    gstAmount,
    qstAmount,
    totalAmount: round2(sub + gstAmount + qstAmount),
  };
}
