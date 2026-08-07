/**
 * Saved client addresses — the half that touches the database.
 *
 * Split from ./client-address so the rules there stay importable by
 * scripts/verify-awer-fixes-3.ts, which may never touch the database and would
 * otherwise pull in PrismaClient just to test a string comparison.
 *
 * awerfixes.pdf item 2 (round 3, stage 4).
 */

import { db } from "@/db";
import {
  autoAddressLabel,
  normalizeAddressKey,
  type AddressParts,
} from "./client-address";

export interface UpsertAddressInput extends AddressParts {
  address: string;
  accessNotes?: string | null;
  /** Overrides the automatic Home/Other label. */
  label?: string | null;
}

const clean = (s?: string | null) => {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : null;
};

/**
 * Find-or-create this address in the client's book, returning its id.
 *
 * Rules, in one place because three call sites used to disagree (see the
 * header of ./client-address):
 *
 *   • Matching is by `normalizeAddressKey`, which is case/whitespace
 *     insensitive AND unit-aware. Two units at one street are two rows; the
 *     same door typed with different capitalisation is one.
 *   • The client's FIRST ever address becomes their default. Nothing else
 *     changes an existing default — an auto-save must never silently re-point
 *     where a customer's next booking is pre-filled to.
 *   • A match is never overwritten, only ENRICHED: details learned later
 *     (city, postal code, access notes) fill blanks, but a value already on the
 *     row wins. An admin who typed a door code on the client page must not lose
 *     it because a booking form left the field empty.
 *
 * Returns null rather than throwing. Address-book upkeep is a side effect of
 * saving a job or a booking; it must never be the thing that fails one. Callers
 * previously expressed this as `.catch(() => {})` at each site.
 */
export async function upsertClientAddress(
  clientId: string | null | undefined,
  input: UpsertAddressInput
): Promise<string | null> {
  const address = clean(input.address);
  if (!clientId || !address) return null;

  try {
    const aptNumber = clean(input.aptNumber);
    const key = normalizeAddressKey(address, aptNumber);

    const existing = await db.clientAddress.findMany({
      where: { clientId },
      select: {
        id: true,
        address: true,
        aptNumber: true,
        city: true,
        postalCode: true,
        accessNotes: true,
      },
    });

    const match = existing.find(
      (a) => normalizeAddressKey(a.address, a.aptNumber) === key
    );

    if (match) {
      // Enrich blanks only — never clobber what is already recorded.
      const patch: Record<string, string> = {};
      const city = clean(input.city);
      const postalCode = clean(input.postalCode);
      const accessNotes = clean(input.accessNotes);
      if (city && !match.city) patch.city = city;
      if (postalCode && !match.postalCode) patch.postalCode = postalCode;
      if (accessNotes && !match.accessNotes) patch.accessNotes = accessNotes;
      if (Object.keys(patch).length > 0) {
        await db.clientAddress.update({ where: { id: match.id }, data: patch });
      }
      return match.id;
    }

    const created = await db.clientAddress.create({
      data: {
        clientId,
        label: clean(input.label) ?? autoAddressLabel(existing.length),
        address,
        aptNumber,
        city: clean(input.city),
        postalCode: clean(input.postalCode),
        accessNotes: clean(input.accessNotes),
        isDefault: existing.length === 0,
      },
      select: { id: true },
    });
    return created.id;
  } catch {
    return null;
  }
}

/**
 * Confirm a client-supplied address id really belongs to this client.
 *
 * `submitBooking` is a PUBLIC, unauthenticated server action — identity there
 * comes from the verified Stripe deposit and the email, never from a session —
 * so an `addressId` arriving in the request body is untrusted input, exactly
 * like the Stripe ids that action already refuses to take on faith. Returns the
 * id when it checks out, otherwise null (the caller falls back to the typed
 * address rather than failing the booking).
 */
export async function resolveOwnedAddressId(
  clientId: string | null | undefined,
  addressId: string | null | undefined
): Promise<string | null> {
  if (!clientId || !addressId) return null;
  try {
    const row = await db.clientAddress.findFirst({
      where: { id: addressId, clientId },
      select: { id: true },
    });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the ClientAddress a job should be linked to, given both what was
 * picked and what was actually typed.
 *
 * The picked id and the address text can disagree: an admin selects "Home",
 * then edits the Location field to a different property. Honouring the id alone
 * would link the job to Home while serving somewhere else — and the cleaner's
 * job page would then show **Home's door codes for a different building**. That
 * is the failure this function exists to prevent.
 *
 * So the picked row is kept only when it still describes the typed address
 * (normalised, unit-aware). Otherwise the typed address is upserted and the job
 * links to that instead. Correcting a typo in a street keeps the link, because
 * the normalised key ignores case and whitespace; replacing the address does
 * not.
 *
 * Returns null when there is no client or no address — a job with no address
 * simply has no provenance.
 */
export async function resolveJobAddressId(
  clientId: string | null | undefined,
  input: { addressId?: string | null } & UpsertAddressInput
): Promise<string | null> {
  const address = clean(input.address);
  if (!clientId || !address) return null;

  const pickedId = await resolveOwnedAddressId(clientId, input.addressId);
  if (pickedId) {
    try {
      const picked = await db.clientAddress.findUnique({
        where: { id: pickedId },
        select: { address: true, aptNumber: true },
      });
      if (
        picked &&
        normalizeAddressKey(picked.address, picked.aptNumber) ===
          normalizeAddressKey(address, input.aptNumber)
      ) {
        return pickedId;
      }
    } catch {
      // Fall through to the upsert — a lookup failure must not mislink.
    }
  }

  return upsertClientAddress(clientId, input);
}

/** The select every saved-address picker and manager reads. */
export const SAVED_ADDRESS_SELECT = {
  id: true,
  label: true,
  address: true,
  aptNumber: true,
  city: true,
  postalCode: true,
  accessNotes: true,
  isDefault: true,
} as const;

/** The ordering every saved-address list uses: default first, then oldest. */
export const SAVED_ADDRESS_ORDER = [
  { isDefault: "desc" as const },
  { createdAt: "asc" as const },
];
