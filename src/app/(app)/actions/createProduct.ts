"use server";

import { db } from "@/db";
import { revalidatePath } from "next/cache";

type State = {
  message: string;
  error: string;
};

export default async function createProduct(
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
    await db.product.create({
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

