"use server";

import { db } from "@/db";
import { syncDefaultLocationStock } from "@/lib/inventory";
import { revalidatePath } from "next/cache";
import type { ProductCategory, Prisma } from "@prisma/client";
import { requireOwnerAdmin } from "@/lib/action-guards";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { sanitizeHttpUrl } from "@/lib/safe-url";
import { parseProductLinks } from "@/lib/product-links";

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
  // Cleaner restock threshold (item 14). Optional — absent/blank means "use the
  // default", so it must not fail the isNaN validation below.
  const cleanerRestockRaw = formData.get("cleanerRestockThreshold");
  const cleanerRestockParsed =
    typeof cleanerRestockRaw === "string" && cleanerRestockRaw.trim() !== ""
      ? parseFloat(cleanerRestockRaw)
      : 0;
  const cleanerRestockThreshold =
    Number.isFinite(cleanerRestockParsed) && cleanerRestockParsed > 0
      ? cleanerRestockParsed
      : 0;
  // Optional free-text reason for the stock-count adjustment (audit trail).
  const stockReasonRaw = (formData.get("stockReason") as string) || "";
  const stockReason = stockReasonRaw.trim().slice(0, 500) || null;
  const categoryRaw = (formData.get("category") as string) || "OTHER";
  const category: ProductCategory = ALLOWED_CATEGORIES.includes(categoryRaw as ProductCategory)
    ? (categoryRaw as ProductCategory)
    : "OTHER";

  // Purchase links. The primary "buy it again" link plus any number of extras.
  // Only absolute http(s) URLs are stored (sanitizeHttpUrl) — a javascript:/data:
  // value would otherwise become an XSS payload the moment it's rendered as an
  // <a href> on the product page.
  const purchaseUrlRaw = (formData.get("purchaseUrl") as string) || "";
  const purchaseUrl = purchaseUrlRaw.trim()
    ? sanitizeHttpUrl(purchaseUrlRaw)
    : null;
  if (purchaseUrlRaw.trim() && !purchaseUrl) {
    return {
      message: "",
      error: "The purchase link must be a full http:// or https:// URL.",
    };
  }
  const parsedLinks = parseProductLinks(formData.get("links"));
  if (!parsedLinks.ok) {
    return { message: "", error: parsedLinks.error };
  }

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
      cleanerRestockThreshold,
      category,
      purchaseUrl,
    };

    const previousStock = previous?.stockLevel ?? 0;
    const stockMoved = !!previous && previous.stockLevel !== stockLevel;

    // Only stamp who/when the count changed when the stock level actually moved.
    let actor: { id?: string; name?: string } | undefined;
    if (stockMoved) {
      const session = await auth.api.getSession({ headers: await headers() });
      actor = session?.user as { id?: string; name?: string } | undefined;
      data.stockUpdatedAt = new Date();
      data.stockUpdatedById = actor?.id ?? null;
      data.stockUpdatedByName = actor?.name ?? null;
    }

    // Update the product and write the audit row atomically so the count and
    // its history can never drift apart.
    await db.$transaction(async (tx) => {
      await tx.product.update({ where: { id: productId }, data });

      // The form submits the full list, so replace it wholesale (add/edit/remove
      // in one shot) inside the same transaction as the product update.
      await tx.productLink.deleteMany({ where: { productId } });
      if (parsedLinks.links.length > 0) {
        await tx.productLink.createMany({
          data: parsedLinks.links.map((l) => ({
            productId,
            label: l.label,
            url: l.url,
          })),
        });
      }

      if (stockMoved) {
        await tx.inventoryChange.create({
          data: {
            productId,
            employeeId: null,
            employeeName: null,
            quantityChange: stockLevel - previousStock,
            newQuantity: stockLevel,
            unit,
            reason: stockReason,
            changedById: actor?.id ?? null,
            changedByName: actor?.name ?? null,
          },
        });
      }
    });

    // Keep the cleaner-facing per-location stock in sync with the admin edit.
    await syncDefaultLocationStock(productId, stockLevel - previousStock);

    revalidatePath("/admin/inventory");
    revalidatePath(`/admin/inventory/${productId}`);
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

