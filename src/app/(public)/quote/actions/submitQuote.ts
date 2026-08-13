"use server";

import { db } from "@/db";
import { sendCustomerQuoteReceived, sendAdminQuoteRequest } from "@/lib/email";
import { getSetting } from "@/lib/settings";
import { getServiceCatalog } from "@/lib/service-catalog.server";
import { activeServices, serviceLabelMap } from "@/lib/service-catalog";
import { storeWallClockToUtc } from "@/lib/timezone";
import {
  QUOTE_PAGE_CONFIG_KEY,
  isQuoteFieldRequired,
  isQuoteFieldVisible,
  normalizeQuotePageConfig,
  quoteFieldLabel,
  type QuoteFieldKey,
} from "@/lib/quote-page-config";

export interface QuoteSubmissionInput {
  name: string;
  email: string;
  phone?: string;
  address?: string;
  /** Canonical service CATEGORY key (RESIDENTIAL, COMMERCIAL, …), not a label. */
  serviceType?: string;
  bedCount?: number;
  bathCount?: number;
  squareFootage?: number;
  preferredDate?: string;
  message?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function submitQuote(input: QuoteSubmissionInput) {
  const [rawConfig, catalog] = await Promise.all([
    getSetting(QUOTE_PAGE_CONFIG_KEY),
    getServiceCatalog(),
  ]);
  const config = normalizeQuotePageConfig(rawConfig);
  const offered = activeServices(catalog);

  /* ---- service first: every other field's config can depend on it -------- */
  //
  // 10.1: the dropdown now stores the canonical CATEGORY KEY, which is what
  // makes a quote's service mappable onto a real job type (the old code wrote
  // `input.serviceType?.trim()` as free text). Anything not in the ACTIVE
  // catalog is refused rather than stored, so a service switched off in
  // Settings can't be requested through a stale page or a crafted POST — which
  // is the client's own example of what turning a service off should mean.
  const serviceVisible = isQuoteFieldVisible(config, "serviceType");
  const rawService = serviceVisible ? input.serviceType?.trim() || "" : "";
  if (rawService && !offered.some((s) => s.category === rawService)) {
    return { success: false, error: "That service is no longer offered" };
  }
  const serviceType = rawService || null;
  const scope = serviceType ?? undefined;

  /* ---------------------------- field values ------------------------------ */

  const text: Record<string, string> = {
    name: input.name?.trim() ?? "",
    email: input.email?.trim().toLowerCase() ?? "",
    phone: input.phone?.trim() ?? "",
    address: input.address?.trim() ?? "",
    message: input.message?.trim() ?? "",
    preferredDate: input.preferredDate?.trim() ?? "",
  };
  const numeric: Record<string, number | null> = {
    bedCount: cleanInt(input.bedCount),
    bathCount: cleanInt(input.bathCount),
    squareFootage: cleanInt(input.squareFootage),
  };

  // A field the admin has hidden must not be storable, whatever was posted —
  // otherwise hiding a question would only hide it from honest visitors.
  const keep = (key: QuoteFieldKey) => isQuoteFieldVisible(config, key, scope);
  for (const key of Object.keys(text) as QuoteFieldKey[]) {
    if (!keep(key)) text[key] = "";
  }
  for (const key of Object.keys(numeric) as QuoteFieldKey[]) {
    if (!keep(key)) numeric[key] = null;
  }

  /* ------------------------------ validation ------------------------------ */
  //
  // Required-ness is the admin's setting, enforced here rather than only in the
  // browser. `name` and `email` are locked required in the config, so the two
  // guards this action always had survive any edit.
  const required = (key: QuoteFieldKey) => isQuoteFieldRequired(config, key, scope);
  const label = (key: QuoteFieldKey) => quoteFieldLabel(config, key, scope);

  for (const key of Object.keys(text) as QuoteFieldKey[]) {
    if (required(key) && text[key] === "") {
      return { success: false, error: `${label(key)} is required` };
    }
  }
  for (const key of Object.keys(numeric) as QuoteFieldKey[]) {
    if (required(key) && numeric[key] === null) {
      return { success: false, error: `${label(key)} is required` };
    }
  }
  if (required("serviceType") && !serviceType) {
    return { success: false, error: `${label("serviceType")} is required` };
  }
  if (text.email !== "" && !text.email.includes("@")) {
    return { success: false, error: "Valid email is required" };
  }

  // Date-only strings used to go through `new Date(str)`, which reads them as
  // UTC midnight — 8 PM the previous evening in Montréal, so the inbox (which
  // formats in STORE_TZ) displayed the day before the one the customer picked.
  // Same root cause Stage 2 fixed across the app; fixed here while rewriting.
  const preferredDate =
    text.preferredDate && DATE_RE.test(text.preferredDate)
      ? storeWallClockToUtc(text.preferredDate)
      : null;

  const quote = await db.quoteRequest.create({
    data: {
      name: text.name,
      email: text.email,
      phone: text.phone || null,
      address: text.address || null,
      serviceType,
      bedCount: numeric.bedCount,
      bathCount: numeric.bathCount,
      squareFootage: numeric.squareFootage,
      preferredDate,
      message: text.message || null,
      source: "landing_page",
    },
  });

  // The admin alert reads the service as a human label — it now stores a
  // category key, and "RESIDENTIAL" in an email is worse than the free text it
  // replaced. The admin's own service name from the catalog is the right one.
  const serviceLabel = serviceType
    ? serviceLabelMap(catalog)[serviceType] ?? serviceType
    : null;

  sendCustomerQuoteReceived({
    to: text.email,
    clientName: text.name,
    quoteId: quote.id,
  }).catch((e) => console.error("customer quote receipt email", e));

  sendAdminQuoteRequest({
    quoteId: quote.id,
    name: text.name,
    email: text.email,
    phone: text.phone || null,
    serviceType: serviceLabel,
    message: text.message || null,
  }).catch((e) => console.error("admin quote alert email", e));

  return { success: true, quoteId: quote.id };
}

/** Non-negative whole number, or null. Guards against NaN/Infinity from input. */
function cleanInt(v: number | undefined): number | null {
  if (v === undefined || v === null) return null;
  if (!Number.isFinite(v)) return null;
  const n = Math.trunc(v);
  return n < 0 ? null : n;
}
