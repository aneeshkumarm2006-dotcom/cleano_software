import { requireAdmin } from "@/lib/page-guards";
import { db } from "@/db";
import PromoCodesClient from "./PromoCodesClient";

export default async function PromoCodesPage() {
  await requireAdmin();

  const codes = await db.promoCode.findMany({
    orderBy: { createdAt: "desc" },
  });

  const serialized = codes.map((c) => ({
    id: c.id,
    code: c.code,
    description: c.description,
    discountType: c.discountType,
    discountValue: c.discountValue,
    maxUses: c.maxUses,
    usesCount: c.usesCount,
    expiresAt: c.expiresAt?.toISOString() ?? null,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "1px solid rgba(0,140,156,0.1)" }}>
        <a href="/gift-cards" style={{ padding: "8px 18px", fontSize: 13, fontWeight: 400, color: "rgba(0,140,156,0.5)", textDecoration: "none", borderBottom: "2px solid transparent", marginBottom: -1, display: "inline-block" }}>Gift Cards</a>
        <a href="/promo-codes" style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, color: "#008C9C", textDecoration: "none", borderBottom: "2px solid #008C9C", marginBottom: -1, display: "inline-block" }}>Promo Codes</a>
      </div>
      <PromoCodesClient codes={serialized} />
    </div>
  );
}
