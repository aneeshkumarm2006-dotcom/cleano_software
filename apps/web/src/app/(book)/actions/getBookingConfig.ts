"use server";

import { db } from "@/lib/org-db";
import { getSetting } from "@/lib/settings";
import { getServicePricingConfig } from "@/lib/booking-pricing";
import { normalizeAddOnCatalog, type AddOnCatalogEntry } from "@/lib/addon-catalog";
import { ADDON_ICON_KEY_SET } from "@/lib/addon-icons";
import {
  SERVICE_CONTENT_KEY,
  ServiceContentConfig,
  normalizeServiceContent,
} from "@/lib/service-content";
import {
  BOOKING_PAGE_CONFIG_KEY,
  type BookingPageConfig,
} from "@/lib/booking-page-config";
import { getTaxRates } from "@/lib/tax.server";
import type { TaxRates } from "@/lib/tax";
import { orgStripeStatus } from "@/lib/stripe-org";
import { workspaceName } from "@/lib/workspace-name";

// The shape, its validation and the room enum all live in @/lib/addon-catalog.
// They cannot live here: this file is `"use server"`, so it may only export
// async functions. Re-exported as types (erased at runtime) so the existing
// import sites keep working.
export type { RoomType, AddOnCatalogEntry } from "@/lib/addon-catalog";
export type BookingAddOn = AddOnCatalogEntry;

export async function getBookingConfig(): Promise<{
  addOns: BookingAddOn[];
  minLeadDays: number;
  smsOptInDefault: boolean;
  /** Per-service-category recurring discount table (item 7), for display. */
  frequencyDiscounts: Record<string, Record<string, number>>;
  /** "What's included" text + graphic per service type (item 3). */
  serviceContent: ServiceContentConfig;
  /** Admin-editable field layout for the booking flow (item 17). */
  bookingPage: BookingPageConfig;
  /**
   * This workspace's sales tax rates (Sept 17, item 7).
   *
   * Sent to the browser rather than assumed there. The booking page used to
   * compute its own tax from the Quebec constants, so Calgary's page quoted
   * GST 5% + QST 9.975% however Calgary's settings were filled in.
   */
  taxRates: TaxRates;
  /**
   * THIS workspace's Stripe publishable key, for mounting the deposit form.
   *
   * It has to come from here for the same reason the tax rates do. The booking
   * page used to call `loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)`,
   * which is a single build-time value shared by every tenant — so a workspace
   * that connected its own Stripe account in Settings got a card form pointed
   * at somebody else's account, or, when the variable was unset, no card form
   * at all. The deposit PaymentIntent is already created against the correct
   * account server-side (`stripeForCurrentOrg`), so the browser MUST confirm it
   * with the matching key or Stripe simply cannot find the intent.
   *
   * Publishable keys are public by design; this is what they are for.
   */
  stripePublishableKey: string | null;
  /**
   * Who the customer is buying from.
   *
   * The booking page carries the company name in a left-hand panel that is
   * hidden below 900px, so on a phone — where most bookings happen — the first
   * screen a paying customer saw had no company name or logo anywhere on it.
   */
  businessName: string;
}> {
  const [minLeadDays, smsOptInDefault, pricingCfg, contentSetting, bookingPage, taxRates, stripeStatus, businessName] =
    await Promise.all([
      getSetting("scheduling.minLeadDays"),
      getSetting("customer.smsOptInDefault"),
      getServicePricingConfig(),
      db.appSetting.findFirst({ where: { key: SERVICE_CONTENT_KEY } }),
      getSetting(BOOKING_PAGE_CONFIG_KEY),
      getTaxRates(),
      orgStripeStatus().catch(() => null),
      workspaceName().catch(() => ""),
    ]);
  const frequencyDiscounts = pricingCfg.frequencyDiscounts;
  const serviceContent = normalizeServiceContent(contentSetting?.value);
  const stripePublishableKey = stripeStatus?.publishableKey ?? null;
  const rest = {
    minLeadDays,
    smsOptInDefault,
    frequencyDiscounts,
    serviceContent,
    bookingPage,
    taxRates,
    stripePublishableKey,
    businessName,
  };
  try {
    const setting = await db.appSetting.findFirst({
      where: { key: "pricing.addOns" },
    });

    if (!setting || !Array.isArray(setting.value)) {
      return { addOns: [], ...rest };
    }

    const normalized = normalizeAddOnCatalog(setting.value, ADDON_ICON_KEY_SET);

    return { addOns: normalized, ...rest };
  } catch {
    return { addOns: [], ...rest };
  }
}
