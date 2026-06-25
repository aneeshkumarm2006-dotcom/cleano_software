import { requireAdmin } from "@/lib/page-guards";
import { db } from "@/db";
import GiftCardsAdminClient from "./GiftCardsAdminClient";

export default async function GiftCardsAdminPage() {
  await requireAdmin();

  const cards = await db.giftCard.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "1px solid rgba(0,140,156,0.1)" }}>
        <a href="/admin/gift-cards" style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, color: "#008C9C", textDecoration: "none", borderBottom: "2px solid #008C9C", marginBottom: -1, display: "inline-block" }}>Gift Cards</a>
        <a href="/admin/promo-codes" style={{ padding: "8px 18px", fontSize: 13, fontWeight: 400, color: "rgba(0,140,156,0.5)", textDecoration: "none", borderBottom: "2px solid transparent", marginBottom: -1, display: "inline-block" }}>Promo Codes</a>
      </div>
      <GiftCardsAdminClient
        cards={cards.map((c) => ({
          id: c.id,
          code: c.code,
          amount: c.amount,
          status: c.status,
          purchaserName: c.purchaserName,
          purchaserEmail: c.purchaserEmail,
          recipientName: c.recipientName,
          recipientEmail: c.recipientEmail,
          personalMessage: c.personalMessage,
          coverKey: c.coverKey,
          scheduledDeliveryDate: c.scheduledDeliveryDate?.toISOString() ?? null,
          deliveredAt: c.deliveredAt?.toISOString() ?? null,
          redeemedAt: c.redeemedAt?.toISOString() ?? null,
          createdAt: c.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
