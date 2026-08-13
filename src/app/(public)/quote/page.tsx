import type { Metadata } from "next";
import { getSetting } from "@/lib/settings";
import { getServiceCatalog } from "@/lib/service-catalog.server";
import { serviceOptions } from "@/lib/service-catalog";
import {
  QUOTE_PAGE_CONFIG_KEY,
  normalizeQuotePageConfig,
} from "@/lib/quote-page-config";
import QuoteFormClient from "./QuoteFormClient";

/**
 * Reads the admin-editable page config on every render rather than at build
 * time — an admin who renames a field in the Form tab expects to reload /quote
 * and see it, not to wait for a redeploy.
 */
export const dynamic = "force-dynamic";

async function loadQuotePage() {
  const [config, catalog, brandName] = await Promise.all([
    getSetting(QUOTE_PAGE_CONFIG_KEY),
    getServiceCatalog(),
    getSetting("general.businessName"),
  ]);
  return {
    // `getSetting` already validates through the registry; normalizing again is
    // cheap and keeps this page total even if the setting is written by a path
    // that bypasses the spine.
    config: normalizeQuotePageConfig(config),
    // THE service list (item 20): values are canonical category keys, so
    // switching a service off in Settings → Job Types removes it from here.
    services: serviceOptions(catalog),
    brandName,
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const { config, brandName } = await loadQuotePage();
  return {
    title: `${config.copy.title} · ${brandName}`,
    description: config.copy.subhead,
  };
}

export default async function QuotePage() {
  const { config, services, brandName } = await loadQuotePage();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f7faf9 0%, #ffffff 100%)",
        padding: "48px 16px",
      }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {/* Header, fields and success copy all render inside QuoteForm, from
            the config — there is no literal customer-facing string left here. */}
        <QuoteFormClient
          config={config}
          services={services}
          brandName={brandName}
        />
      </div>
    </div>
  );
}
