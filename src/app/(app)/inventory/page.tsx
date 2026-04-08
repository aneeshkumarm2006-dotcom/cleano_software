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
  const allProducts = await db.product.findMany({
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
  });

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

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <InventoryPageClient
        initialProducts={productsWithStats}
        initialSearch={search}
        initialStatus={status}
        initialPage={page}
        initialRowsPerPage={rowsPerPage}
      />
    </div>
  );
}
