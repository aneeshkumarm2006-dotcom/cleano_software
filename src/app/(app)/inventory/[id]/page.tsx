import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
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

  const userRole = (session.user as any).role;
  if (userRole === "EMPLOYEE") {
    redirect("/dashboard");
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
    },
  });

  if (!product) {
    redirect("/inventory");
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
  };

  const jobUsageData = product.jobUsage.map((usage) => ({
    id: usage.id,
    quantity: usage.quantity,
    createdAt: usage.createdAt.toISOString(),
    job: {
      id: usage.job.id,
      clientName: usage.job.clientName,
      employee: {
        name: usage.job.employee.name,
      },
    },
  }));

  const employeeAssignmentsData = product.employeeProducts.map((ep) => ({
    id: ep.id,
    quantity: ep.quantity,
    assignedAt: ep.assignedAt.toISOString(),
    notes: ep.notes,
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
    />
  );
}
