import { db } from "@/lib/org-db";
import { requireCleaner } from "@/lib/page-guards";
import {
  cleanerRestockThreshold,
  itemAttentionState,
  usesDefaultCleanerThreshold,
} from "@/lib/inventory-thresholds";
import { loadCleanerThresholdDefault } from "@/lib/inventory-thresholds.server";
import MyInventoryClient from "./MyInventoryClient";

export default async function MyInventoryPage() {
  const session = await requireCleaner();
  const userId = session.user.id;

  const [employeeProducts, inventoryLocations, pendingRequests, defaultThreshold, catalog] =
    await Promise.all([
      db.employeeProduct.findMany({
        where: { employeeId: userId },
        include: { product: true },
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
      loadCleanerThresholdDefault(),
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
    // CLEANER restock threshold only — never the company reorder point
    // (fix list item 14). A configured 0 falls back to the admin's global
    // default, so a cleaner is warned before they hit empty rather than after.
    //
    // `itemType` is the Stage 2 addition: it is what stops a reusable tool from
    // being judged against a refill threshold at all (PDF #4).
    const thresholdInput = {
      cleanerRestockThreshold: ep.product.cleanerRestockThreshold,
      defaultThreshold,
      itemType: ep.product.itemType,
    };
    const usesDefault = usesDefaultCleanerThreshold(thresholdInput);
    const refillThreshold = cleanerRestockThreshold(thresholdInput);

    // ONE classification, shared by the pill, the copy, the CTA and the hero
    // count. Everything else on this screen reads `attention` — nothing
    // re-derives "is this a problem?" for itself.
    const attention = itemAttentionState({
      ...thresholdInput,
      quantity: ep.quantity,
      condition: ep.condition,
      // Stage 3: for a liquid, the level reported at clock-out is the only
      // honest signal there is — nothing deducts millilitres any more, so the
      // count on this row does not move on its own.
      levelStatus: ep.levelStatus,
    });

    const isOutOfStock =
      attention.kind === "EMPTY" ||
      (attention.kind === "LEVEL" && attention.level === "EMPTY");
    const isLow =
      attention.kind === "LOW" ||
      (attention.kind === "LEVEL" && attention.level === "LOW");
    const pending = pendingByProductId.get(ep.productId) ?? null;

    return {
      id: ep.id,
      productId: ep.productId,
      productName: ep.product.name,
      productDescription: ep.product.description,
      unit: ep.product.unit,
      quantity: ep.quantity,
      itemType: ep.product.itemType,
      refillThreshold,
      usesDefaultThreshold: usesDefault,
      assignedAt: ep.assignedAt.toISOString(),
      updatedAt: ep.updatedAt.toISOString(),
      attention,
      condition: ep.condition,
      levelStatus: ep.levelStatus,
      statusNotes: ep.statusNotes,
      statusUpdatedAt: ep.statusUpdatedAt
        ? ep.statusUpdatedAt.toISOString()
        : null,
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
