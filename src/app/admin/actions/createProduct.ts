"use server";

import { db } from "@/db";
import { adjustWarehouseStock } from "@/lib/stock.server";
import { revalidatePath } from "next/cache";
import type { ProductCategory } from "@prisma/client";
import { requireOwnerAdmin } from "@/lib/action-guards";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { sanitizeHttpUrl } from "@/lib/safe-url";
import { parseProductLinks } from "@/lib/product-links";
import { inferItemType, isItemType, type ItemType } from "@/lib/item-type";

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
  const categoryRaw = (formData.get("category") as string) || "OTHER";
  const category: ProductCategory = ALLOWED_CATEGORIES.includes(categoryRaw as ProductCategory)
    ? (categoryRaw as ProductCategory)
    : "OTHER";

  // Item type (inventory fixes PDF #1). The modal always sends one; anything
  // else reaching this action (an older client, a script) gets the same
  // name/category heuristic the CSV importer and the backfill use, rather than
  // a blanket "consumable" that would put a bucket back on refill thresholds.
  const itemTypeRaw = formData.get("itemType");
  const itemType: ItemType = isItemType(itemTypeRaw)
    ? itemTypeRaw
    : inferItemType({ name: (formData.get("name") as string) || "", category });

  // Purchase links — same allow-list rule as updateProduct: absolute http(s)
  // only, so a stored link can never become script when rendered as an href.
  const purchaseUrlRaw = (formData.get("purchaseUrl") as string) || "";
  const purchaseUrl = purchaseUrlRaw.trim() ? sanitizeHttpUrl(purchaseUrlRaw) : null;
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

    // Stamp who set the initial count and when (always on create).
    const session = await auth.api.getSession({ headers: await headers() });
    const user = session?.user as { id?: string; name?: string } | undefined;

    // Create the product, then place its opening stock — both in one
    // transaction, so a product can never exist with a count nobody put
    // anywhere.
    await db.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name,
          description: description || null,
          unit,
          costPerUnit,
          // Opening count deliberately 0 here: `adjustWarehouseStock` sets it
          // from the location rows below. Per-location stock is the truth and
          // `stockLevel` is its cache (Stage 4 / decision D5) — writing the
          // number in two places is what let them drift.
          stockLevel: 0,
          minStock,
          cleanerRestockThreshold,
          category,
          itemType,
          purchaseUrl,
          stockUpdatedAt: new Date(),
          stockUpdatedById: user?.id ?? null,
          stockUpdatedByName: user?.name ?? null,
          ...(parsedLinks.links.length > 0
            ? {
                links: {
                  create: parsedLinks.links.map((l) => ({
                    label: l.label,
                    url: l.url,
                  })),
                },
              }
            : {}),
        },
        select: { id: true },
      });

      // Places the opening stock in the default location so cleaners can see
      // and pick it up (cleaner pickup reads per-location stock), recomputes
      // `stockLevel` from it, and records where the number came from. A zero
      // opening count is a no-op and writes no audit row.
      await adjustWarehouseStock(tx, {
        productId: product.id,
        delta: stockLevel,
        action: "ADMIN_SET",
        unit,
        reason: "Opening stock count",
        actor: user,
      });
    }, {
      // The create plus `adjustWarehouseStock`'s four queries; the same
      // Supabase round-trip latency that blows the default 5s window open on
      // the other stock movements applies here.
      maxWait: 10_000,
      timeout: 30_000,
    });

    revalidatePath("/admin/inventory");
    revalidatePath("/admin/settings");
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

