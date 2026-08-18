"use server";

import { db } from "@/db";
import { adjustWarehouseStock, reconcileProductStock } from "@/lib/stock.server";
import { revalidatePath } from "next/cache";
import type { ProductCategory, Prisma } from "@prisma/client";
import { requireOwnerAdmin } from "@/lib/action-guards";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { sanitizeHttpUrl } from "@/lib/safe-url";
import { parseProductLinks } from "@/lib/product-links";
import { isItemType } from "@/lib/item-type";

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
  // Item type (inventory fixes PDF #1). Unlike create, a missing or invalid
  // value here means "leave it alone": an admin's deliberate classification must
  // not be silently re-guessed by a form that didn't send the field.
  const itemTypeRaw = formData.get("itemType");
  const itemType = isItemType(itemTypeRaw) ? itemTypeRaw : null;

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

  // Validate numeric values. `stockLevel` is checked separately below, against
  // the count this product already carries — see there.
  if (costPerUnit < 0 || minStock < 0) {
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

    // Warehouse stock is allowed to be negative, deliberately — supplies move
    // outside the app, so a short count is recorded and reconciled later rather
    // than blocked (see the header of `src/lib/stock.server.ts`). A flat
    // `stockLevel < 0` here therefore made a product that had gone short
    // impossible to save at ALL: not renamed, not reclassified, not corrected.
    // The floor is the count already on record when that is below zero, and 0
    // otherwise — the same rule ProductModal applies, so the form and the
    // server agree about what is refusable.
    const current = await db.product.findUnique({
      where: { id: productId },
      select: { stockLevel: true },
    });
    const stockFloor = Math.min(0, current?.stockLevel ?? 0);
    if (stockLevel < stockFloor) {
      return {
        message: "",
        error:
          stockFloor < 0
            ? `Warehouse stock is already at ${stockFloor} for this product — leave it there or type a higher count. It can't be pushed further negative here.`
            : "Warehouse stock cannot be negative.",
      };
    }

    // `stockLevel` is deliberately absent from this payload: per-location rows
    // are the truth and `Product.stockLevel` is a cache recomputed from them by
    // `adjustWarehouseStock` (Stage 4 / decision D5). Writing it here as well
    // would be the second, competing writer this stage exists to remove.
    const data: Prisma.ProductUpdateInput = {
      name,
      description: description || null,
      unit,
      costPerUnit,
      minStock,
      cleanerRestockThreshold,
      category,
      ...(itemType ? { itemType } : {}),
      purchaseUrl,
    };

    // The stock stamp needs an actor, and we don't yet know whether the count
    // moved (that answer comes from inside the transaction, below). Read the
    // session once here rather than conditionally — it is a cached call, and
    // the alternative is an await in the middle of a transaction.
    const session = await auth.api.getSession({ headers: await headers() });
    const actor = session?.user as { id?: string; name?: string } | undefined;

    // One transaction: the product, its links, the stock movement and the audit
    // row, so a count and its history can never drift apart.
    await db.$transaction(async (tx) => {
      // Work the delta out from the TRUTH, not from the cached number. On a
      // database that predates `scripts/reconcileWarehouseStock.ts` the two can
      // still disagree, and starting from the reconciled figure means this save
      // repairs the drift instead of carrying it forward. Nothing physically
      // moved, so this writes no history of its own.
      const { stockLevel: previousStock } = await reconcileProductStock(
        tx,
        productId
      );

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

      // "Warehouse Stock" is an ABSOLUTE total. Applying it as a delta to one
      // location preserves stock manually distributed to the others and still
      // lands the total on exactly the number the admin typed.
      if (previousStock !== stockLevel) {
        await adjustWarehouseStock(tx, {
          productId,
          delta: stockLevel - previousStock,
          action: "ADMIN_SET",
          unit,
          reason: stockReason,
          actor,
        });

        // Only stamp who/when the count changed when it actually changed.
        await tx.product.update({
          where: { id: productId },
          data: {
            stockUpdatedAt: new Date(),
            stockUpdatedById: actor?.id ?? null,
            stockUpdatedByName: actor?.name ?? null,
          },
        });
      }
    }, {
      // Reconcile, product update, link replace, then `adjustWarehouseStock`'s
      // four queries and the stock stamp. Supabase round-trips take that past
      // Prisma's default 5s window, and a P2028 halfway through would roll the
      // whole save back while still answering 200.
      maxWait: 10_000,
      timeout: 30_000,
    });

    revalidatePath("/admin/inventory");
    revalidatePath(`/admin/inventory/${productId}`);
    // Settings → Manage Stock reads the location rows this may have moved.
    revalidatePath("/admin/settings");
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

