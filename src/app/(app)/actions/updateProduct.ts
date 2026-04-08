"use server";

import { db } from "@/db";
import { revalidatePath } from "next/cache";

type State = {
  message: string;
  error: string;
};

export async function updateProduct(
  productId: string,
  prevState: State,
  formData: FormData
): Promise<State> {
  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  const unit = formData.get("unit") as string;
  const costPerUnit = parseFloat(formData.get("costPerUnit") as string);
  const stockLevel = parseFloat(formData.get("stockLevel") as string);
  const minStock = parseFloat(formData.get("minStock") as string);

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

    // Update the product
    await db.product.update({
      where: { id: productId },
      data: {
        name,
        description: description || null,
        unit,
        costPerUnit,
        stockLevel,
        minStock,
      },
    });

    revalidatePath("/inventory");
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

