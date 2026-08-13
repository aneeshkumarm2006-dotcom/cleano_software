"use client";

/**
 * Thin client boundary for `/quote`.
 *
 * All rendering lives in `@/components/quote/QuoteForm`, which the admin Form
 * tab mounts as its live preview — so this file exists only to hand the shared
 * renderer the `submitQuote` server action. Everything it used to contain (ten
 * hardcoded fields, a private `inputStyle` object, a `SERVICE_OPTIONS` array
 * that contradicted the service catalog) is gone.
 */

import QuoteForm, { type QuoteFormValues } from "@/components/quote/QuoteForm";
import { submitQuote } from "./actions/submitQuote";
import type { QuotePageConfig } from "@/lib/quote-page-config";

export default function QuoteFormClient({
  config,
  services,
  brandName,
}: {
  config: QuotePageConfig;
  services: { value: string; label: string }[];
  brandName: string;
}) {
  async function handleSubmit(values: QuoteFormValues) {
    return submitQuote({
      name: values.name,
      email: values.email,
      phone: values.phone || undefined,
      address: values.address || undefined,
      serviceType: values.serviceType || undefined,
      bedCount: values.bedCount ? Number(values.bedCount) : undefined,
      bathCount: values.bathCount ? Number(values.bathCount) : undefined,
      squareFootage: values.squareFootage ? Number(values.squareFootage) : undefined,
      preferredDate: values.preferredDate || undefined,
      message: values.message || undefined,
    });
  }

  return (
    <QuoteForm
      config={config}
      services={services}
      brandName={brandName}
      onSubmit={handleSubmit}
    />
  );
}
