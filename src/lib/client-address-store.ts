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
import { mergeBlankPropertySize, readPropertySize } from "./property-size";

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

/** The columns the blanks-only enrichment reads before it decides to write. */
type EnrichableAddress = {
  city: string | null;
  postalCode: string | null;
  accessNotes: string | null;
  propertyType: string | null;
  bedCount: number | null;
  bathCount: number | null;
  halfBathCount: number | null;
  squareFootage: number | null;
};

/**
 * Teach an existing address row what this save knows — **blanks only**, never
 * clobbering what is already recorded.
 *
 * Extracted from `upsertClientAddress` because `resolveJobAddressId` needs the
 * identical rule on the path that does NOT upsert. When an admin picks a saved
 * address from the dropdown and leaves the Location field alone, that function
 * returns the picked id early — correctly, because the picked row already IS
 * the address. But "already the right row" is not "already knows everything":
 * that is precisely the booking that was supposed to teach the address book its
 * postal code and property size, and returning early skipped the lesson. The
 * result was item 3's headline promise failing on its most ordinary path — book
 * a job at a saved address, fill in the room counts, and the address stayed
 * blank, so the next booking re-prompted for the same numbers forever.
 *
 * Blanks-only in both directions, as everywhere else: a value already on the
 * row wins (a booking that says 2 bedrooms can never overwrite the 3 somebody
 * recorded after actually going there), and a blank on the form can never erase
 * what is stored. Zero is a value, not a blank — a studio has 0 bedrooms.
 *
 * Never throws: address-book upkeep is a side effect of saving a job and must
 * not be the thing that fails one.
 */
async function enrichAddressBlanks(
  id: string,
  row: EnrichableAddress,
  input: UpsertAddressInput
): Promise<void> {
  try {
    const patch: Record<string, string | number> = {};
    const city = clean(input.city);
    const postalCode = clean(input.postalCode);
    const accessNotes = clean(input.accessNotes);
    if (city && !row.city) patch.city = city;
    if (postalCode && !row.postalCode) patch.postalCode = postalCode;
    if (accessNotes && !row.accessNotes) patch.accessNotes = accessNotes;
    // Property size (item 3) — the same blanks-only rule, in one helper so the
    // five columns cannot drift apart the way four hand-written `if`s would.
    // Zero is a value here (a studio has 0 bedrooms), which is why this cannot
    // be `if (input.bedCount && !row.bedCount)`.
    Object.assign(patch, mergeBlankPropertySize(row, input));
    if (Object.keys(patch).length > 0) {
      await db.clientAddress.update({ where: { id }, data: patch });
    }
  } catch {
    // Deliberately swallowed — see the note above.
  }
}

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
 *     (city, postal code, access notes, and since item 3 the property size)
 *     fill blanks, but a value already on the row wins. An admin who typed a
 *     door code on the client page must not lose it because a booking form left
 *     the field empty — and a booking that says "2 bedrooms" must not overwrite
 *     the "3" somebody recorded after actually going there.
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
        propertyType: true,
        bedCount: true,
        bathCount: true,
        halfBathCount: true,
        squareFootage: true,
      },
    });

    const match = existing.find(
      (a) => normalizeAddressKey(a.address, a.aptNumber) === key
    );

    if (match) {
      await enrichAddressBlanks(match.id, match, input);
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
        // A brand-new row has nothing to protect, so the size goes straight on
        // — normalised through the same reader the blanks-only merge uses, so a
        // "" from a form and a 0 from a studio land as null and 0 respectively.
        ...readPropertySize(input),
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
        select: {
          address: true,
          aptNumber: true,
          // Read for the blanks-only enrichment below, NOT to decide the link.
          city: true,
          postalCode: true,
          accessNotes: true,
          propertyType: true,
          bedCount: true,
          bathCount: true,
          halfBathCount: true,
          squareFootage: true,
        },
      });
      if (
        picked &&
        normalizeAddressKey(picked.address, picked.aptNumber) ===
          normalizeAddressKey(address, input.aptNumber)
      ) {
        // The picked row IS the address, so no upsert is needed — but it still
        // has to LEARN from this save, or the one path item 3 exists for (pick
        // the saved address, type the room counts, save) would teach the book
        // nothing and re-prompt the admin for the same numbers next time.
        await enrichAddressBlanks(pickedId, picked, input);
        return pickedId;
      }
    } catch {
      // Fall through to the upsert — a lookup failure must not mislink.
    }
  }

  return upsertClientAddress(clientId, input);
}

/**
 * The select every saved-address picker and manager reads.
 *
 * The property-size columns are in it since item 3, and they have to be: the
 * point of storing the size on the address is that picking the address on a job
 * form pre-fills it, which cannot happen if the picker never loaded it.
 */
export const SAVED_ADDRESS_SELECT = {
  id: true,
  label: true,
  address: true,
  aptNumber: true,
  city: true,
  postalCode: true,
  accessNotes: true,
  propertyType: true,
  bedCount: true,
  bathCount: true,
  halfBathCount: true,
  squareFootage: true,
  isDefault: true,
} as const;

/** The ordering every saved-address list uses: default first, then oldest. */
export const SAVED_ADDRESS_ORDER = [
  { isDefault: "desc" as const },
  { createdAt: "asc" as const },
];
