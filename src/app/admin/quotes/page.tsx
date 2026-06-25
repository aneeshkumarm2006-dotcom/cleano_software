import { requireAdmin } from "@/lib/page-guards";
import { db } from "@/db";
import QuotesInboxClient from "./QuotesInboxClient";

export default async function QuotesPage() {
  await requireAdmin();

  const quotes = await db.quoteRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <QuotesInboxClient
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
