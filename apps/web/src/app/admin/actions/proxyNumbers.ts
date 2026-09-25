"use server";

import { revalidatePath } from "next/cache";

import { requireOwnerAdmin } from "@/lib/action-guards";
import { db } from "@/lib/org-db";
import { toE164 } from "@/lib/sms";

/**
 * The pool of company numbers that phone masking hands out.
 *
 * A pooled number is bought in Twilio, pointed at this app's two webhooks, and
 * then lent to one cleaner↔customer pair at a time. Everything an admin can do
 * to that pool lives here, and every one of these is an independently callable
 * RPC endpoint, so every one of them authorizes on its own.
 */

/** One pooled number, as the Connectors tab renders it. */
export interface ProxyNumberRow {
  id: string;
  phoneNumber: string;
  label: string | null;
  isActive: boolean;
  /** Pairings still routable through this number. Zero means it is idle. */
  livePairings: number;
}

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; message: string };

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

export async function listProxyNumbers(): Promise<Result<{ numbers: ProxyNumberRow[] }>> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false, message: guard.error };

  try {
    const now = new Date();
    const [rows, live] = await Promise.all([
      db.proxyNumber.findMany({
        orderBy: [{ createdAt: "asc" }],
        select: { id: true, phoneNumber: true, label: true, isActive: true },
      }),
      // Expired rows are still in the table until something sweeps them, so the
      // count an admin reads has to ask about `expiresAt` rather than trusting
      // the row's existence — otherwise a long-dead pairing makes a free number
      // look busy and nobody dares delete it.
      db.maskedContact.groupBy({
        by: ["proxyNumberId"],
        where: { expiresAt: { gt: now } },
        _count: { _all: true },
      }),
    ]);

    const counts = new Map(live.map((g) => [g.proxyNumberId, g._count._all]));
    return {
      ok: true,
      numbers: rows.map((r) => ({ ...r, livePairings: counts.get(r.id) ?? 0 })),
    };
  } catch (e) {
    console.error("[proxyNumbers] list failed", e);
    return { ok: false, message: "Could not load the masked number pool." };
  }
}

export async function addProxyNumber(
  phoneNumber: string,
  label?: string,
): Promise<Result> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false, message: guard.error };

  // Refused rather than stored: a pool number that is not E.164 can never match
  // the `To` Twilio sends, so it would sit in the list looking configured and
  // silently route nothing.
  const e164 = toE164(phoneNumber ?? "");
  if (!e164) {
    return {
      ok: false,
      message: "That is not a number we can dial. Use the full number, e.g. +15145551234.",
    };
  }

  try {
    await db.proxyNumber.create({
      data: { phoneNumber: e164, label: label?.trim() || null },
    });
  } catch (e) {
    // `ProxyNumber.phoneNumber` is unique across the whole platform, not per
    // workspace — inbound calls carry nothing but the number dialled, so it has
    // to identify one workspace. Which workspace holds it is not this admin's
    // business, so the message says that it is taken and nothing more.
    if (isUniqueViolation(e)) {
      return { ok: false, message: `${e164} is already connected to a workspace.` };
    }
    console.error("[proxyNumbers] add failed", e);
    return { ok: false, message: "Could not add that number." };
  }

  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function setProxyNumberActive(
  id: string,
  isActive: boolean,
): Promise<Result> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false, message: guard.error };
  if (!id) return { ok: false, message: "Missing number." };

  try {
    await db.proxyNumber.update({ where: { id }, data: { isActive } });
  } catch (e) {
    console.error("[proxyNumbers] activate failed", e);
    return { ok: false, message: "Could not change that number." };
  }

  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function removeProxyNumber(id: string): Promise<Result> {
  const guard = await requireOwnerAdmin();
  if (!guard.ok) return { ok: false, message: guard.error };
  if (!id) return { ok: false, message: "Missing number." };

  try {
    // `MaskedContact.proxyNumberId` cascades, so deleting a number in use tears
    // down the pairings riding on it: a cleaner mid-job dials the number they
    // were given and reaches nobody. Deactivating stops new pairings being
    // allocated onto it and leaves the live ones relaying until they expire.
    const live = await db.maskedContact.count({
      where: { proxyNumberId: id, expiresAt: { gt: new Date() } },
    });
    if (live > 0) {
      return {
        ok: false,
        message:
          `This number is carrying ${live} live conversation${live === 1 ? "" : "s"}. ` +
          "Turn it off instead — that stops it being handed out again, and the " +
          "conversations already on it keep working until they expire.",
      };
    }

    await db.proxyNumber.delete({ where: { id } });
  } catch (e) {
    console.error("[proxyNumbers] remove failed", e);
    return { ok: false, message: "Could not remove that number." };
  }

  revalidatePath("/admin/settings");
  return { ok: true };
}
