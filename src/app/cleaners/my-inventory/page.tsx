import { db } from "@/db";
import { requireCleaner } from "@/lib/page-guards";
import { getSetting } from "@/lib/settings";
import {
  cleanerRestockThreshold,
  isCleanerLow,
  usesDefaultCleanerThreshold,
} from "@/lib/inventory-thresholds";
import MyInventoryClient from "./MyInventoryClient";

export default async function MyInventoryPage() {
  const session = await requireCleaner();
  const userId = session.user.id;

  const [employeeProducts, inventoryLocations, pendingRequests, defaultThreshold, catalog] =
    await Promise.all([
      db.employeeProduct.findMany({
        where: { employeeId: userId },
        include: {
          product: {
            include: {
              inventoryRule: true,
            },
          },
        },
        orderBy: {
          product: { name: "asc" },
        },
      }),
      db.inventoryLocation.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
      }),
      // Open refill requests, so the UI can show per-item "Requested" state and
      // stop a cleaner from firing off duplicates.
      db.inventoryRequest.findMany({
        where: {
          employeeId: userId,
          status: "PENDING",
          productId: { not: null },
        },
        select: { productId: true, quantity: true, createdAt: true },
      }),
      getSetting("inventory.defaultRefillThreshold"),
      // Product catalog for the "Add item" (starting inventory) picker.
      db.product.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, unit: true },
        orderBy: { name: "asc" },
      }),
    ]);

  const pendingByProductId = new Map(
    pendingRequests
      .filter((r): r is typeof r & { productId: string } => !!r.productId)
      .map((r) => [
        r.productId,
        { quantity: r.quantity, createdAt: r.createdAt.toISOString() },
      ])
  );

  const items = employeeProducts.map((ep) => {
    const rule = ep.product.inventoryRule;
    const usagePerJob = rule?.usagePerJob ?? 0;

    // CLEANER restock threshold only — never the company reorder point
    // (fix list item 14). A configured 0 falls back to covering one more job,
    // so a cleaner is warned before they hit empty rather than after.
    const thresholdInput = {
      cleanerRestockThreshold: ep.product.cleanerRestockThreshold,
      usagePerJob,
      defaultThreshold,
    };
    const usesDefault = usesDefaultCleanerThreshold(thresholdInput);
    const refillThreshold = cleanerRestockThreshold(thresholdInput);

    const isOutOfStock = ep.quantity <= 0;
    const isLow = !isOutOfStock && isCleanerLow(ep.quantity, thresholdInput);
    const pending = pendingByProductId.get(ep.productId) ?? null;

    return {
      id: ep.id,
      productId: ep.productId,
      productName: ep.product.name,
      productDescription: ep.product.description,
      unit: ep.product.unit,
      quantity: ep.quantity,
      refillThreshold,
      usesDefaultThreshold: usesDefault,
      usagePerJob,
      assignedAt: ep.assignedAt.toISOString(),
      updatedAt: ep.updatedAt.toISOString(),
      isLow,
      isOutOfStock,
      pendingRequest: pending,
    };
  });

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <MyInventoryClient
        items={items}
        locations={inventoryLocations.map((l) => ({
          id: l.id,
          name: l.name,
          address: l.address,
        }))}
        catalog={catalog}
      />
    </div>
  );
}
