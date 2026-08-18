"use server";

import { db } from "@/db";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { INVENTORY_FLAG_LABEL } from "@/lib/inventory-status";

/**
 * Working the inventory attention queue (cleano_inventory_operations_fixes.pdf
 * #1/#2 — "reports should create a flag for admin review/restock", Stage 3.5).
 *
 * A flag is raised by a cleaner: at clock-out, from My Inventory, or with an
 * issue report. It stays OPEN until an admin does one of three things:
 *
 *   RESOLVE   the problem is dealt with — the tool was replaced, the bottle
 *             refilled. Carries an optional note, because "resolved" without a
 *             record of what happened is how a queue teaches people to ignore it.
 *   DISMISS   there was nothing to do. Distinct from resolved ON PURPOSE: an
 *             owner asking "how often does a scraper actually break?" needs the
 *             false reports separable from the real ones.
 *   RESTOCK   the answer is "send them more", which is an InventoryRequest —
 *             the approval queue that already exists, with warehouse stock
 *             checks and an audit trail. `createRestockRequestFromFlag` opens
 *             one pre-filled and leaves the flag open until it is fulfilled.
 *
 * OWNER/ADMIN/OPS_MANAGER only — the same gate the rest of the inventory hub's
 * write actions use. A cleaner resolves their own flags by reporting the item
 * as fine again (`updateMyItemCondition`), never from here.
 */

const MAX_NOTE_LEN = 300;

type Guarded =
  | { ok: true; actor: { id: string; name: string | null } }
  | { ok: false; error: string };

async function requireInventoryAdmin(): Promise<Guarded> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return { ok: false, error: "Not authenticated" };
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return { ok: false, error: "Not authorized" };
  }
  return {
    ok: true,
    actor: { id: session.user.id, name: session.user.name ?? null },
  };
}

export async function resolveInventoryFlag(input: {
  flagId: string;
  decision: "RESOLVED" | "DISMISSED";
  note?: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const guard = await requireInventoryAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  if (input.decision !== "RESOLVED" && input.decision !== "DISMISSED") {
    return { success: false, error: "Invalid decision" };
  }

  const flag = await db.inventoryFlag.findUnique({
    where: { id: input.flagId },
    select: { id: true, status: true, notes: true },
  });
  if (!flag) return { success: false, error: "Flag not found" };
  if (flag.status !== "OPEN") {
    return { success: false, error: "This flag has already been closed" };
  }

  const note = input.note?.trim().slice(0, MAX_NOTE_LEN) || null;

  await db.inventoryFlag.update({
    where: { id: flag.id },
    data: {
      status: input.decision,
      resolvedAt: new Date(),
      resolvedById: guard.actor.id,
      // The cleaner's note is what raised the flag; the admin's is what closed
      // it. Appended rather than overwritten so neither is lost.
      notes: note
        ? flag.notes
          ? `${flag.notes}\n— ${guard.actor.name ?? "Admin"}: ${note}`
          : `${guard.actor.name ?? "Admin"}: ${note}`
        : flag.notes,
    },
  });

  revalidatePath("/admin/inventory");
  revalidatePath("/cleaners/my-inventory");
  return { success: true };
}

/**
 * Turn a flag into a refill request, pre-filled for the cleaner and product it
 * was raised against.
 *
 * This is the loop the PDF asks for closing: a cleaner reports empty at
 * clock-out, an admin sees the flag, and one click puts the restock into the
 * SAME approval queue an explicit cleaner request goes through — where Stage 4's
 * warehouse-stock work will decide honestly whether it can be fulfilled. No
 * second, parallel restock path.
 *
 * The flag stays OPEN. It represents "this cleaner is short of this thing",
 * which is still true while the request waits for approval; closing it here
 * would drop the problem out of sight the moment somebody clicked a button.
 */
export async function createRestockRequestFromFlag(input: {
  flagId: string;
  quantity?: number;
}): Promise<
  | { success: true; requestId: string; alreadyPending: boolean }
  | { success: false; error: string }
> {
  const guard = await requireInventoryAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  const flag = await db.inventoryFlag.findUnique({
    where: { id: input.flagId },
    include: {
      product: { select: { id: true, name: true, unit: true } },
      employee: { select: { id: true, name: true } },
    },
  });
  if (!flag) return { success: false, error: "Flag not found" };
  if (flag.status !== "OPEN") {
    return { success: false, error: "This flag has already been closed" };
  }

  const requested = Number(input.quantity ?? 1);
  if (!Number.isFinite(requested) || requested <= 0 || requested > 1000) {
    return { success: false, error: "Enter a quantity between 1 and 1000" };
  }
  const quantity = Math.floor(requested);

  // Same idempotency rule as `createInventoryRequest`: one open request per
  // (employee, product). An admin clicking twice, or clicking after the cleaner
  // already asked, must not put two rows in the approval queue — that is how
  // the 48-row backlog on p.5 of the PDF was built.
  const existing = await db.inventoryRequest.findFirst({
    where: {
      employeeId: flag.employeeId,
      productId: flag.productId,
      status: "PENDING",
    },
    select: { id: true },
  });
  if (existing) {
    return { success: true, requestId: existing.id, alreadyPending: true };
  }

  const request = await db.inventoryRequest.create({
    data: {
      employeeId: flag.employeeId,
      productId: flag.productId,
      quantity,
      reason:
        `Restock from inventory flag: ${INVENTORY_FLAG_LABEL[flag.type]}` +
        (flag.notes ? ` — ${flag.notes.split("\n")[0]}` : ""),
      status: "PENDING",
    },
  });

  revalidatePath("/admin/inventory");
  revalidatePath(`/admin/employees/${flag.employeeId}`);
  revalidatePath("/cleaners/my-inventory");
  return { success: true, requestId: request.id, alreadyPending: false };
}
