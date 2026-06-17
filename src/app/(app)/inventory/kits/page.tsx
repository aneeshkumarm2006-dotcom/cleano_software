import { requireAdmin } from "@/lib/page-guards";
import { db } from "@/db";
import KitsAdminClient from "./KitsAdminClient";

export default async function KitsPage() {
  await requireAdmin();

  const [cleaners, products] = await Promise.all([
    db.user.findMany({
      where: { role: { in: ["EMPLOYEE", "FIELD_LEAD"] } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        assignedProducts: {
          orderBy: { product: { name: "asc" } },
          include: {
            product: {
              select: {
                id: true,
                name: true,
                unit: true,
                stockLevel: true,
                category: true,
              },
            },
          },
        },
      },
    }),
    db.product.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        unit: true,
        stockLevel: true,
        category: true,
      },
    }),
  ]);

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "1px solid rgba(0,140,156,0.1)" }}>
        <a href="/inventory" style={{ padding: "8px 18px", fontSize: 13, fontWeight: 400, color: "rgba(0,140,156,0.5)", textDecoration: "none", borderBottom: "2px solid transparent", marginBottom: -1, display: "inline-block" }}>Inventory</a>
        <a href="/inventory/kits" style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, color: "#008C9C", textDecoration: "none", borderBottom: "2px solid #008C9C", marginBottom: -1, display: "inline-block" }}>Cleaner Kits</a>
      </div>
      <KitsAdminClient
        cleaners={cleaners.map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email ?? "",
          kit: c.assignedProducts.map((ep) => ({
            employeeProductId: ep.id,
            productId: ep.product.id,
            productName: ep.product.name,
            unit: ep.product.unit,
            category: ep.product.category,
            quantity: ep.quantity,
            masterStock: ep.product.stockLevel,
          })),
        }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          unit: p.unit,
          stockLevel: p.stockLevel,
          category: p.category,
        }))}
      />
    </div>
  );
}
