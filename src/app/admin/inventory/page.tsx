import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { productWhere } from "@/lib/metrics";
import {
  cleanerRestockThreshold,
  isCleanerLow,
  isCompanyLow,
} from "@/lib/inventory-thresholds";
import { projectUsage } from "@/lib/inventory-forecast";
import { loadPerJobAverages } from "@/lib/inventory-forecast.server";
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
  const userRole = (session.user as any).role;
  if (userRole === "EMPLOYEE") {
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
  const [allProducts, supplierPrices, activeSuppliers, employees] =
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

  // Forecast input: what cleaners ACTUALLY reported using, per job, over the
  // trailing window (item 14). This replaces InventoryRule.usagePerJob — an
  // admin-typed guess that went stale and left rule-less products projecting
  // zero. Windowed on Job.jobDate rather than the row's createdAt, which dates
  // only the first clock-out (see src/lib/inventory-forecast.ts).
  const avgPerJob = await loadPerJobAverages();

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
    },
  });
  const lastChangeByKey = new Map<
    string,
    { at: string; by: string | null; delta: number; reason: string | null }
  >();
  for (const c of recentKitChanges) {
    const key = `${c.employeeId}|${c.productId}`;
    // findMany is already newest-first, so the first hit for a key wins.
    if (lastChangeByKey.has(key)) continue;
    lastChangeByKey.set(key, {
      at: c.createdAt.toISOString(),
      by: c.changedByName,
      delta: c.quantityChange,
      reason: c.reason,
    });
  }

  // Per-cleaner assigned-stock overview (aggregate EmployeeProduct). Only
  // cleaners that actually hold stock are surfaced.
  const cleanerInventory = employees
    .map((emp) => {
      const items = emp.assignedProducts.map((ep) => {
        // CLEANER restock threshold — the company reorder point (minStock) has
        // no bearing on how much one cleaner should carry (fix list item 14).
        const thresholdInput = {
          cleanerRestockThreshold: ep.product.cleanerRestockThreshold,
        };
        return {
          productId: ep.productId,
          productName: ep.product.name,
          unit: ep.product.unit,
          quantity: ep.quantity,
          costPerUnit: ep.product.costPerUnit,
          refillThreshold: cleanerRestockThreshold(thresholdInput),
          isLow: isCleanerLow(ep.quantity, thresholdInput),
          lastChange: lastChangeByKey.get(`${emp.id}|${ep.productId}`) ?? null,
        };
      });
      return {
        employeeId: emp.id,
        employeeName: emp.name,
        role: (emp as { role?: string }).role ?? "EMPLOYEE",
        itemCount: items.length,
        totalUnits: items.reduce((s, i) => s + i.quantity, 0),
        totalValue: items.reduce((s, i) => s + i.quantity * i.costPerUnit, 0),
        lowCount: items.filter((i) => i.isLow).length,
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

  const forecastData = employees
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
        };
        return {
          productId: ep.productId,
          productName: ep.product.name,
          unit: ep.product.unit,
          currentQuantity: ep.quantity,
          averagePerJob: Math.round(averagePerJob * 100) / 100,
          refillThreshold: cleanerRestockThreshold(thresholdInput),
          projectedUsage,
          deficit,
          needsRefill: deficit > 0 || isCleanerLow(ep.quantity, thresholdInput),
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

  const assignProducts = productsWithStats.map((p) => ({
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
