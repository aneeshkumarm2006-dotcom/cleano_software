import { requireAdmin } from "@/lib/page-guards";
import { db } from "@/db";
import { getSetting } from "@/lib/settings";
import { getServiceCatalogWithLabels } from "@/lib/service-catalog.server";
import { serviceOptions } from "@/lib/service-catalog";
import {
  QUOTE_PAGE_CONFIG_KEY,
  normalizeQuotePageConfig,
} from "@/lib/quote-page-config";
import QuotesInboxClient from "./QuotesInboxClient";

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await requireAdmin();
  const role = (session.user as { role?: string }).role;
  // The Form tab writes an audited AppSetting, so only the two roles that may
  // write settings get to see it. OPS_MANAGER / FIELD_LEAD keep the inbox.
  const canEditForm = role === "OWNER" || role === "ADMIN";

  const params = await searchParams;
  const archived = params.archived === "1";

  const [quotes, { catalog, labels }, quoteConfigRaw, brandName] =
    await Promise.all([
      db.quoteRequest.findMany({
        where: { deletedAt: archived ? { not: null } : null },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      getServiceCatalogWithLabels(),
      getSetting(QUOTE_PAGE_CONFIG_KEY),
      getSetting("general.businessName"),
    ]);

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <QuotesInboxClient
        archived={archived}
        canEditForm={canEditForm}
        // Quotes now store the canonical service CATEGORY key (10.1); the
        // inbox resolves it through the admin's own service names, and falls
        // back to the raw text for rows submitted before the change.
        serviceLabels={labels}
        quoteConfig={normalizeQuotePageConfig(quoteConfigRaw)}
        services={serviceOptions(catalog)}
        brandName={brandName}
        quotes={quotes.map((q) => ({
          id: q.id,
          name: q.name,
          email: q.email,
          phone: q.phone,
          address: q.address,
          serviceType: q.serviceType,
          bedCount: q.bedCount,
          bathCount: q.bathCount,
          squareFootage: q.squareFootage,
          preferredDate: q.preferredDate?.toISOString() ?? null,
          message: q.message,
          status: q.status,
          notes: q.notes,
          createdAt: q.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
