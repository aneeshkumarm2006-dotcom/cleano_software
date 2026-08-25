import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/org-db";
import { productWhere } from "@/lib/metrics";
import {
  cleanerRestockThreshold,
  isCleanerLow,
  isCompanyLow,
  itemAttentionState,
} from "@/lib/inventory-thresholds";
import { loadCleanerThresholdDefault } from "@/lib/inventory-thresholds.server";
import { projectUsage } from "@/lib/inventory-forecast";
import { INVENTORY_FORECAST_ENABLED } from "@/lib/inventory-forecast.flag";
import { loadPerJobAverages } from "@/lib/inventory-forecast.server";
import { ASSIGNABLE_PRODUCT_WHERE } from "@/lib/kit-product.server";
import InventoryPageClient from "./InventoryPageClient";

type SearchParams = Promise<{
  [key: string]: string | string[] | undefined;
}>;

// Allow bulk CSV import (processed by the importCsv server action) enough time.
export const maxDuration = 60;

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  // Admin only - OWNER or ADMIN
  // The comment above has always said OWNER/ADMIN; the code only ever excluded
  // EMPLOYEE, which the admin layout already does — so this was a no-op and the
  // page (cost per unit, total inventory value, supplier price comparisons) was
  // open to OPS_MANAGER and FIELD_LEAD. The nav entry is `adminOnly: true`,
  // which hid it without protecting it.
  const userRole = (session.user as any).role;
  if (userRole !== "OWNER" && userRole !== "ADMIN") {
    redirect("/admin/dashboard");
  }
  // Editing a cleaner's kit count is OWNER/ADMIN only (setCleanerProductQuantity
  // enforces the same rule server-side). Anyone else — e.g. an OPS_MANAGER who can
  // still open this page — gets the read-only view. Fail closed.
  const canEditCleanerInventory = userRole === "OWNER" || userRole === "ADMIN";

  // Parse search params
  const params = await searchParams;
  const search = (params.search as string) || "";
  // Accept the dashboard deep-link's shorthand (`?status=low`) and map it to the
  // canonical filter value the inventory list understands.
  const rawStatus = (params.status as string) || "all";
  const status = rawStatus === "low" ? "low-stock" : rawStatus;
  // Optional deep-link straight to a hub sub-view (e.g. ?view=requests).
  const view = (params.view as string) || "products";
  const page = Number(params.page) || 1;
  const rowsPerPage = Number(params.rowsPerPage) || 10;
  const archived = params.archived === "1";

  // Fetch all products with their employee assignments
  const [allProducts, supplierPrices, activeSuppliers, employees, defaultThreshold] =
    await Promise.all([
      db.product.findMany({
        where: productWhere(archived),
        include: {
          employeeProducts: {
            include: {
              employee: true,
            },
          },
          links: { orderBy: { createdAt: "asc" } },
        },
        orderBy: {
          name: "asc",
        },
      }),
      db.supplierPrice.findMany({
        include: {
          supplier: true,
          product: true,
        },
      }),
      db.supplier.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
      }),
      db.user.findMany({
        where: { role: { in: ["EMPLOYEE", "ADMIN", "OWNER"] } },
        include: {
          assignedProducts: {
            include: { product: true },
          },
          jobs: {
            where: {
              status: { in: ["CREATED", "SCHEDULED", "IN_PROGRESS"] },
              jobDate: { gte: new Date() },
            },
            select: { id: true },
          },
        },
        orderBy: { name: "asc" },
      }),
      // The admin's global refill floor. This page used to omit it, so the
      // Cleaner Inventory tab judged kits against the built-in 1 while the
      // cleaner's own app used the configured 2 — same product, two answers.
      loadCleanerThresholdDefault(),
    ]);

  // Calculate stats for each product
  const productsWithStats = allProducts.map((product) => {
    const employeeProducts = product.employeeProducts || [];
    const totalAssigned = employeeProducts.reduce(
      (sum, ep) => sum + ep.quantity,
      0
    );
    const employeeCount = employeeProducts.length;

    return {
      id: product.id,
      name: product.name,
      description: product.description,
      unit: product.unit,
      costPerUnit: product.costPerUnit,
      stockLevel: product.stockLevel,
      minStock: product.minStock,
      cleanerRestockThreshold: product.cleanerRestockThreshold,
      category: product.category,
      itemType: product.itemType,
      stockUpdatedAt: product.stockUpdatedAt
        ? product.stockUpdatedAt.toISOString()
        : null,
      stockUpdatedByName: product.stockUpdatedByName,
      // Re-order links. Sanitized again on render (never trust stored data).
      purchaseUrl: product.purchaseUrl,
      links: product.links.map((l) => ({ label: l.label ?? "", url: l.url })),
      totalAssigned,
      employeeCount,
      totalInventory: product.stockLevel + totalAssigned,
      // COMPANY reorder point only — this drives the "needs purchasing" tile
      // and badge. Cleaner kits are judged separately (fix list item 14).
      isLowStock: isCompanyLow(product),
    };
  });

  // Build supplier comparison data
  const supplierProductMap = new Map<
    string,
    {
      productId: string;
      productName: string;
      unit: string;
      costPerUnit: number;
      supplierPrices: Array<{
        supplierId: string;
        supplierName: string;
        price: number;
        unit: string | null;
        notes: string | null;
      }>;
    }
  >();

  for (const sp of supplierPrices) {
    if (!supplierProductMap.has(sp.productId)) {
      supplierProductMap.set(sp.productId, {
        productId: sp.productId,
        productName: sp.product.name,
        unit: sp.product.unit,
        costPerUnit: sp.product.costPerUnit,
        supplierPrices: [],
      });
    }
    supplierProductMap.get(sp.productId)!.supplierPrices.push({
      supplierId: sp.supplierId,
      supplierName: sp.supplier.name,
      price: sp.price,
      unit: sp.unit,
      notes: sp.notes,
    });
  }

  const supplierData = {
    products: Array.from(supplierProductMap.values()),
    suppliers: activeSuppliers.map((s) => ({
      id: s.id,
      name: s.name,
      website: s.website,
    })),
  };

  // Forecast input: what cleaners reported using, per job, over the trailing
  // window (item 14). HIDDEN since Stage 3 (decision D3) — clock-out no longer
  // records per-job usage, so this window empties out and every product would
  // project 0 while claiming everyone is fully stocked. The loader is only
  // called when the forecast is actually rendered; see
  // `src/lib/inventory-forecast.flag.ts` for how to bring it back.
  const avgPerJob = INVENTORY_FORECAST_ENABLED
    ? await loadPerJobAverages()
    : new Map<string, number>();

  // Most recent audit row per (cleaner, product) — powers the "last updated by X"
  // line on each kit row, so admins can see cleaner-side edits (the cleaner app
  // writes InventoryChange too) without opening the product's Stock History.
  const recentKitChanges = await db.inventoryChange.findMany({
    where: { employeeId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      employeeId: true,
      productId: true,
      createdAt: true,
      changedByName: true,
      quantityChange: true,
      reason: true,
      // Stage 3: the status half of the row, so the Cleaner Inventory tab can
      // answer PDF #2's "admin should see each cleaner's LATEST REPORTED status
      // and history" without a second query per kit line.
      action: true,
      previousStatus: true,
      newStatus: true,
    },
  });
  const lastChangeByKey = new Map<
    string,
    { at: string; by: string | null; delta: number; reason: string | null }
  >();
  const lastReportByKey = new Map<
    string,
    { at: string; previousStatus: string | null; newStatus: string; reason: string | null }
  >();
  for (const c of recentKitChanges) {
    const key = `${c.employeeId}|${c.productId}`;
    // findMany is already newest-first, so the first hit for a key wins.
    if (!lastChangeByKey.has(key)) {
      lastChangeByKey.set(key, {
        at: c.createdAt.toISOString(),
        by: c.changedByName,
        delta: c.quantityChange,
        reason: c.reason,
      });
    }
    // The most recent row that carried a STATUS, which is not necessarily the
    // most recent row at all — an admin correcting a count afterwards must not
    // bury the cleaner's "damaged" report underneath it.
    if (c.newStatus && !lastReportByKey.has(key)) {
      lastReportByKey.set(key, {
        at: c.createdAt.toISOString(),
        previousStatus: c.previousStatus,
        newStatus: c.newStatus,
        reason: c.reason,
      });
    }
  }

  // Open flags, both for the Attention tab and for the per-item chips on the
  // Cleaner Inventory tab. A countable reported "missing" has no status column
  // of its own — the count is its state of record — so its flag IS the way an
  // admin sees what was said about it.
  const openFlagRows = await db.inventoryFlag.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      product: { select: { id: true, name: true, unit: true } },
      employee: { select: { id: true, name: true } },
      job: { select: { id: true, jobNumber: true } },
    },
  });

  const heldByKey = new Map<string, number>();
  for (const emp of employees) {
    for (const ep of emp.assignedProducts) {
      heldByKey.set(`${emp.id}|${ep.productId}`, ep.quantity);
    }
  }

  const attentionFlags = openFlagRows.map((f) => ({
    id: f.id,
    type: f.type,
    source: f.source,
    notes: f.notes,
    createdAt: f.createdAt.toISOString(),
    employeeId: f.employeeId,
    employeeName: f.employee?.name ?? "Unknown",
    productId: f.productId,
    productName: f.product?.name ?? "Deleted product",
    unit: f.product?.unit ?? "",
    quantity: heldByKey.get(`${f.employeeId}|${f.productId}`) ?? 0,
    jobId: f.job?.id ?? null,
    jobNumber: f.job?.jobNumber ?? null,
  }));

  const openFlagTypesByKey = new Map<string, string[]>();
  for (const f of openFlagRows) {
    const key = `${f.employeeId}|${f.productId}`;
    const existing = openFlagTypesByKey.get(key) ?? [];
    if (!existing.includes(f.type)) existing.push(f.type);
    openFlagTypesByKey.set(key, existing);
  }

  // Per-cleaner assigned-stock overview (aggregate EmployeeProduct). Only
  // cleaners that actually hold stock are surfaced.
  const cleanerInventory = employees
    .map((emp) => {
      const items = emp.assignedProducts.map((ep) => {
        // CLEANER restock threshold — the company reorder point (minStock) has
        // no bearing on how much one cleaner should carry (fix list item 14) —
        // and the product's item type, which decides whether a threshold
        // applies at all (PDF #4).
        const thresholdInput = {
          cleanerRestockThreshold: ep.product.cleanerRestockThreshold,
          defaultThreshold,
          itemType: ep.product.itemType,
        };
        // The SAME call the cleaner's own app makes, with the same inputs, so
        // the two screens cannot disagree about a row.
        const attention = itemAttentionState({
          ...thresholdInput,
          quantity: ep.quantity,
          condition: ep.condition,
          levelStatus: ep.levelStatus,
        });
        return {
          productId: ep.productId,
          productName: ep.product.name,
          unit: ep.product.unit,
          quantity: ep.quantity,
          costPerUnit: ep.product.costPerUnit,
          itemType: ep.product.itemType,
          refillThreshold: cleanerRestockThreshold(thresholdInput),
          attention,
          statusUpdatedAt: ep.statusUpdatedAt
            ? ep.statusUpdatedAt.toISOString()
            : null,
          statusNotes: ep.statusNotes,
          isLow: isCleanerLow(ep.quantity, thresholdInput),
          lastChange: lastChangeByKey.get(`${emp.id}|${ep.productId}`) ?? null,
          // PDF #2: "admin should see each cleaner's latest reported inventory
          // status and history". `lastReport` is the status transition itself
          // (previous → new, with the job it came off in its reason); the open
          // flag types are what is still outstanding about it.
          lastReport: lastReportByKey.get(`${emp.id}|${ep.productId}`) ?? null,
          openFlagTypes: openFlagTypesByKey.get(`${emp.id}|${ep.productId}`) ?? [],
        };
      });
      return {
        employeeId: emp.id,
        employeeName: emp.name,
        role: (emp as { role?: string }).role ?? "EMPLOYEE",
        itemCount: items.length,
        totalUnits: items.reduce((s, i) => s + i.quantity, 0),
        totalValue: items.reduce((s, i) => s + i.quantity * i.costPerUnit, 0),
        // Consumables below threshold PLUS tools in a bad condition. Renamed
        // from `lowCount` deliberately: "low" is the wrong word for a scraper
        // that needs replacing, and a same-named field would have carried the
        // old meaning into every consumer unnoticed.
        attentionCount: items.filter((i) => i.attention.needsAttention).length,
        items,
      };
    })
    .filter((e) => e.itemCount > 0);

  // Equipment / refill requests — surfaced in the hub with approve/reject.
  const requestRows = await db.inventoryRequest.findMany({
    include: {
      product: { select: { id: true, name: true, unit: true, stockLevel: true } },
      kitTemplate: { select: { id: true, name: true } },
      employee: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  const requests = requestRows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: r.employee?.name ?? "Unknown",
    productId: r.productId,
    itemName: r.product?.name ?? r.kitTemplate?.name ?? "Unknown item",
    isKit: !r.productId && !!r.kitId,
    unit: r.product?.unit ?? null,
    warehouseStock: r.product?.stockLevel ?? null,
    quantity: r.quantity,
    reason: r.reason,
    status: r.status as "PENDING" | "APPROVED" | "REJECTED" | "FULFILLED",
    createdAt: r.createdAt.toISOString(),
  }));

  const forecastData = (INVENTORY_FORECAST_ENABLED ? employees : [])
    .map((emp) => {
      const upcomingJobCount = emp.jobs.length;
      const items = emp.assignedProducts.map((ep) => {
        // Measured, not configured: the trailing-30-day average across the jobs
        // that actually used this product (item 14).
        const averagePerJob = avgPerJob.get(ep.productId) ?? 0;
        const projectedUsage = projectUsage(averagePerJob, upcomingJobCount);
        const deficit = Math.max(0, projectedUsage - ep.quantity);
        const thresholdInput = {
          cleanerRestockThreshold: ep.product.cleanerRestockThreshold,
          defaultThreshold,
          itemType: ep.product.itemType,
        };
        // Equipment is not consumed by doing jobs, so it can never be short of
        // a projected usage either — `isEquipment` short-circuits both terms.
        const isEquipment = ep.product.itemType === "REUSABLE_EQUIPMENT";
        return {
          productId: ep.productId,
          productName: ep.product.name,
          unit: ep.product.unit,
          currentQuantity: ep.quantity,
          averagePerJob: Math.round(averagePerJob * 100) / 100,
          refillThreshold: cleanerRestockThreshold(thresholdInput),
          projectedUsage,
          deficit: isEquipment ? 0 : deficit,
          needsRefill:
            !isEquipment &&
            (deficit > 0 || isCleanerLow(ep.quantity, thresholdInput)),
        };
      });
      // NOTE: no `.filter(usagePerJob > 0)` here any more. That filter was the
      // bug 20.b names — a product nobody had written a rule for vanished from
      // the forecast entirely, and an employee whose whole kit was rule-less
      // disappeared with it. Every assigned product is now listed; one with no
      // usage history simply projects 0 and is judged on its threshold alone.
      return {
        employeeId: emp.id,
        employeeName: emp.name,
        upcomingJobCount,
        items,
      };
    })
    .filter((e) => e.items.length > 0);

  // ── Quick-assign data (items 6 + 13) ──────────────────────────────────────
  // Deliberately NOT derived from `cleanerInventory`, which only lists cleaners
  // that already hold stock — you must be able to assign to someone with an
  // empty kit. Same for products: every active product is offered, including
  // ones nobody holds yet.
  const [assignLocations, allLocationStock] = await Promise.all([
    db.inventoryLocation.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.inventoryLocationStock.findMany({
      select: { locationId: true, productId: true, quantity: true },
    }),
  ]);

  const stockByProductLocation = new Map<string, Record<string, number>>();
  for (const row of allLocationStock) {
    const existing = stockByProductLocation.get(row.productId) ?? {};
    existing[row.locationId] = row.quantity;
    stockByProductLocation.set(row.productId, existing);
  }

  // Quick Assign must never offer an ARCHIVED product, even while the admin is
  // looking at the Archived tab — assigning one is how a kit row gets orphaned
  // from the catalogue, which is what produced the p.6 "Product not found."
  // (Stage 5). On the normal tab `productsWithStats` is already active-only, so
  // this costs an extra query only on the Archived view.
  const assignableRows = archived
    ? await db.product.findMany({
        where: ASSIGNABLE_PRODUCT_WHERE,
        orderBy: { name: "asc" },
        select: { id: true, name: true, unit: true },
      })
    : productsWithStats;

  const assignProducts = assignableRows.map((p) => ({
    id: p.id,
    name: p.name,
    unit: p.unit,
    stockByLocation: stockByProductLocation.get(p.id) ?? {},
  }));

  const assignCleaners = employees.map((emp) => ({
    id: emp.id,
    name: emp.name,
    held: Object.fromEntries(
      emp.assignedProducts.map((ep) => [ep.productId, ep.quantity])
    ) as Record<string, number>,
  }));

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "1px solid rgba(0,140,156,0.1)" }}>
        <a href="/admin/inventory" style={{ padding: "8px 18px", fontSize: 13, fontWeight: 600, color: "#008C9C", textDecoration: "none", borderBottom: "2px solid #008C9C", marginBottom: -1, display: "inline-block" }}>Inventory</a>
        <a href="/admin/inventory/kits" style={{ padding: "8px 18px", fontSize: 13, fontWeight: 400, color: "rgba(0,140,156,0.5)", textDecoration: "none", borderBottom: "2px solid transparent", marginBottom: -1, display: "inline-block" }}>Cleaner Kits</a>
      </div>
      <InventoryPageClient
        initialProducts={productsWithStats}
        initialSearch={search}
        initialStatus={status}
        initialView={view}
        initialPage={page}
        initialRowsPerPage={rowsPerPage}
        supplierData={supplierData}
        forecastData={forecastData}
        attentionFlags={attentionFlags}
        cleanerInventory={cleanerInventory}
        canEditCleanerInventory={canEditCleanerInventory}
        assignProducts={assignProducts}
        assignCleaners={assignCleaners}
        assignLocations={assignLocations}
        requests={requests}
        archived={archived}
      />
    </div>
  );
}
