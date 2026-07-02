"use server";

import { db } from "@/db";
import { syncDefaultLocationStock } from "@/lib/inventory";
import { revalidatePath } from "next/cache";
import type { ProductCategory, Prisma } from "@prisma/client";
import { requireOwnerAdmin } from "@/lib/action-guards";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

const ALLOWED_CATEGORIES: readonly ProductCategory[] = [
  "LIQUID_SPRAY",
  "MOP_LIQUID",
  "DISPOSABLE",
  "OTHER",
];

type State = {
  message: string;
  error: string;
};

export async function updateProduct(
  productId: string,
  prevState: State,
  formData: FormData
): Promise<State> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { message: "", error: guard.error };

  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  const unit = formData.get("unit") as string;
  const costPerUnit = parseFloat(formData.get("costPerUnit") as string);
  const stockLevel = parseFloat(formData.get("stockLevel") as string);
  const minStock = parseFloat(formData.get("minStock") as string);
  const categoryRaw = (formData.get("category") as string) || "OTHER";
  const category: ProductCategory = ALLOWED_CATEGORIES.includes(categoryRaw as ProductCategory)
    ? (categoryRaw as ProductCategory)
    : "OTHER";

  // Validate required fields
  if (!name || !unit || isNaN(costPerUnit) || isNaN(stockLevel) || isNaN(minStock)) {
    return {
      message: "",
      error: "Please fill in all required fields with valid values.",
    };
  }

  // Validate numeric values
  if (costPerUnit < 0 || stockLevel < 0 || minStock < 0) {
    return {
      message: "",
      error: "Numeric values cannot be negative.",
    };
  }

  try {
    // Check if product name already exists (excluding current product)
    const existingProduct = await db.product.findFirst({
      where: {
        name: { equals: name, mode: "insensitive" },
        NOT: {
          id: productId,
        },
      },
    });

    if (existingProduct) {
      return {
        message: "",
        error: "A product with this name already exists.",
      };
    }

    // Capture the previous stock so we can apply the change as a delta to the
    // default location (preserves stock manually distributed to other locations).
    const previous = await db.product.findUnique({
      where: { id: productId },
      select: { stockLevel: true },
    });

    const data: Prisma.ProductUpdateInput = {
      name,
      description: description || null,
      unit,
      costPerUnit,
      stockLevel,
      minStock,
      category,
    };

    // Only stamp who/when the count changed when the stock level actually moved.
    if (previous && previous.stockLevel !== stockLevel) {
      const session = await auth.api.getSession({ headers: await headers() });
      const user = session?.user as { id?: string; name?: string } | undefined;
      data.stockUpdatedAt = new Date();
      data.stockUpdatedById = user?.id ?? null;
      data.stockUpdatedByName = user?.name ?? null;
    }

    // Update the product
    await db.product.update({
      where: { id: productId },
      data,
    });

    // Keep the cleaner-facing per-location stock in sync with the admin edit.
    await syncDefaultLocationStock(
      productId,
      stockLevel - (previous?.stockLevel ?? 0)
    );

    revalidatePath("/admin/inventory");
    return {
      message: "Product updated successfully!",
      error: "",
    };
  } catch (error) {
    console.error("Error updating product:", error);
    return {
      message: "",
      error: "Failed to update product. Please try again.",
    };
  }
}

