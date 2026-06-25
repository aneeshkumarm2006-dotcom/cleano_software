"use server";

import { db } from "@/db";
import { syncDefaultLocationStock } from "@/lib/inventory";
import { revalidatePath } from "next/cache";
import type { ProductCategory } from "@prisma/client";
import { requireOwnerAdmin } from "@/lib/action-guards";

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

export default async function createProduct(
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
    // Check if product with same name already exists
    const existingProduct = await db.product.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });

    if (existingProduct) {
      return {
        message: "",
        error: "A product with this name already exists.",
      };
    }

    // Create the product
    const product = await db.product.create({
      data: {
        name,
        description: description || null,
        unit,
        costPerUnit,
        stockLevel,
        minStock,
        category,
      },
    });

    // Mirror the initial stock into the default location so cleaners can see
    // and pick it up (cleaner pickup reads per-location stock, not stockLevel).
    await syncDefaultLocationStock(product.id, stockLevel);

    revalidatePath("/admin/inventory");
    return {
      message: "Product created successfully!",
      error: "",
    };
  } catch (error) {
    console.error("Error creating product:", error);
    return {
      message: "",
      error: "Failed to create product. Please try again.",
    };
  }
}

