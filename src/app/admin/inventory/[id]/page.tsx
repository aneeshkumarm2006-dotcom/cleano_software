import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { itemAttentionState } from "@/lib/inventory-thresholds";
import { loadCleanerThresholdDefault } from "@/lib/inventory-thresholds.server";
import ProductDetailView from "./ProductDetailView";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  // The comment above has always said OWNER/ADMIN; the code only ever excluded
  // EMPLOYEE, which the admin layout already does — so this was a no-op and the
  // page (cost per unit, total inventory value, supplier price comparisons) was
  // open to OPS_MANAGER and FIELD_LEAD. The nav entry is `adminOnly: true`,
  // which hid it without protecting it.
  const userRole = (session.user as any).role;
  if (userRole !== "OWNER" && userRole !== "ADMIN") {
    redirect("/admin/dashboard");
  }

  const product = await db.product.findUnique({
    where: { id },
    include: {
      jobUsage: {
        include: {
          job: {
            include: {
              employee: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 6,
      },
      employeeProducts: {
        include: {
          employee: true,
        },
        orderBy: {
          assignedAt: "desc",
        },
      },
      inventoryChanges: {
        orderBy: { createdAt: "desc" },
        take: 25,
      },
      links: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!product) {
    redirect("/admin/inventory");
  }

  // Calculate total quantity assigned to employees
  const totalAssigned = product.employeeProducts.reduce(
    (sum, ep) => sum + ep.quantity,
    0
  );

  // Calculate usage statistics
  const totalUsed = product.jobUsage.reduce(
    (sum, usage) => sum + usage.quantity,
    0
  );

  // Transform data for the client component
  const productData = {
    id: product.id,
    name: product.name,
    description: product.description,
    unit: product.unit,
    costPerUnit: product.costPerUnit,
    stockLevel: product.stockLevel,
    minStock: product.minStock,
    itemType: product.itemType,
    stockUpdatedAt: product.stockUpdatedAt
      ? product.stockUpdatedAt.toISOString()
      : null,
    stockUpdatedByName: product.stockUpdatedByName,
    // Re-order links. Re-sanitized in the view before they become an href.
    purchaseUrl: product.purchaseUrl,
    links: product.links.map((l) => ({
      id: l.id,
      label: l.label ?? "",
      url: l.url,
    })),
  };

  const changeHistory = product.inventoryChanges.map((c) => ({
    id: c.id,
    employeeName: c.employeeName,
    quantityChange: c.quantityChange,
    newQuantity: c.newQuantity,
    unit: c.unit,
    reason: c.reason,
    changedByName: c.changedByName,
    createdAt: c.createdAt.toISOString(),
  }));

  const jobUsageData = product.jobUsage.map((usage) => ({
    id: usage.id,
    quantity: usage.quantity,
    createdAt: usage.createdAt.toISOString(),
    job: {
      id: usage.job.id,
      clientName: usage.job.clientName,
      employee: {
        name: usage.job.employee?.name ?? "Unassigned",
      },
    },
  }));

  // Per-holder status, from the same shared rule the cleaner's own app and the
  // Cleaner Inventory tab use (Stage 2 / PDF #4). Without it this table showed
  // a bare quantity, so "3 people hold a scraper" said nothing about the fact
  // that two of them are damaged.
  const kitThresholdDefault = await loadCleanerThresholdDefault();

  const employeeAssignmentsData = product.employeeProducts.map((ep) => ({
    id: ep.id,
    quantity: ep.quantity,
    assignedAt: ep.assignedAt.toISOString(),
    notes: ep.notes,
    attention: itemAttentionState({
      quantity: ep.quantity,
      condition: ep.condition,
      levelStatus: ep.levelStatus,
      itemType: product.itemType,
      cleanerRestockThreshold: product.cleanerRestockThreshold,
      defaultThreshold: kitThresholdDefault,
    }),
    statusUpdatedAt: ep.statusUpdatedAt ? ep.statusUpdatedAt.toISOString() : null,
    employee: {
      id: ep.employee.id,
      name: ep.employee.name,
      email: ep.employee.email,
    },
  }));

  return (
    <ProductDetailView
      product={productData}
      jobUsage={jobUsageData}
      employeeAssignments={employeeAssignmentsData}
      totalAssigned={totalAssigned}
      totalUsed={totalUsed}
      changeHistory={changeHistory}
    />
  );
}
