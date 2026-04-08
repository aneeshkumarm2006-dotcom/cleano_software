"use server";

import { db } from "@/db";
import { revalidatePath } from "next/cache";

export async function deleteProduct(productId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    // Check if product has any employee assignments or job usage
    const product = await db.product.findUnique({
      where: { id: productId },
      include: {
        employeeProducts: true,
        jobUsage: true,
      },
    });

    if (!product) {
      return {
        success: false,
        error: "Product not found.",
      };
    }

    if (product.employeeProducts.length > 0) {
      return {
        success: false,
        error: "Cannot delete product that is assigned to employees. Please unassign it first.",
      };
    }

    if (product.jobUsage.length > 0) {
      return {
        success: false,
        error: "Cannot delete product that has been used in jobs. Consider archiving instead.",
      };
    }

    // Delete the product
    await db.product.delete({
      where: { id: productId },
    });

    revalidatePath("/inventory");
    return {
      success: true,
    };
  } catch (error) {
    console.error("Error deleting product:", error);
    return {
      success: false,
      error: "Failed to delete product. Please try again.",
    };
  }
}

