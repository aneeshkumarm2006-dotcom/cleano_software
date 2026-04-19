import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import InventoryPageClient from "./InventoryPageClient";

type SearchParams = Promise<{
  [key: string]: string | string[] | undefined;
}>;

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
    redirect("/dashboard");
  }

  // Parse search params
  const params = await searchParams;
  const search = (params.search as string) || "";
  const status = (params.status as string) || "all";
  const page = Number(params.page) || 1;
  const rowsPerPage = Number(params.rowsPerPage) || 10;

  // Fetch all products with their employee assignments
  const [allProducts, supplierPrices, activeSuppliers, employees] =
    await Promise.all([
      db.product.findMany({
        include: {
          employeeProducts: {
            include: {
              employee: true,
            },
          },
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
      totalAssigned,
      employeeCount,
      totalInventory: product.stockLevel + totalAssigned,
      isLowStock: product.stockLevel <= product.minStock,
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
    suppliers: activeSuppliers.map((s) => ({ id: s.id, name: s.name })),
  };

  // Build forecast data
  const inventoryRules = await db.inventoryRule.findMany({
    include: { product: true },
  });

  const forecastData = employees
    .map((emp) => {
      const upcomingJobCount = emp.jobs.length;
      const items = emp.assignedProducts
        .map((ep) => {
          const rule = inventoryRules.find(
            (r) => r.productId === ep.productId
          );
          const usagePerJob = rule?.usagePerJob || 0;
          const projectedUsage = usagePerJob * upcomingJobCount;
          const deficit = Math.max(0, projectedUsage - ep.quantity);
          return {
            productId: ep.productId,
            productName: ep.product.name,
            unit: ep.product.unit,
            currentQuantity: ep.quantity,
            usagePerJob,
            refillThreshold: rule?.refillThreshold || 0,
            projectedUsage,
            deficit,
            needsRefill:
              deficit > 0 || ep.quantity <= (rule?.refillThreshold || 0),
          };
        })
        .filter((f) => f.usagePerJob > 0);

      return {
        employeeId: emp.id,
        employeeName: emp.name,
        upcomingJobCount,
        items,
      };
    })
    .filter((e) => e.items.length > 0);

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <InventoryPageClient
        initialProducts={productsWithStats}
        initialSearch={search}
        initialStatus={status}
        initialPage={page}
        initialRowsPerPage={rowsPerPage}
        supplierData={supplierData}
        forecastData={forecastData}
      />
    </div>
  );
}
