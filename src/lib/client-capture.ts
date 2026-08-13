/**
 * New-customer capture for the admin job forms (Stage 4.2, client feedback
 * item 4 — "we need that in order to send them alerts").
 *
 * A job saved with a typed name and no linked client used to store the name as
 * free text with `clientId: null`. Every customer-facing email in the admin is
 * gated on `job.client?.email` and silently no-ops when it is missing, so those
 * bookings could never receive a receipt, a cancellation notice, a rating
 * request or a card link — and could not be charged off-session. Creating the
 * Client row is therefore the actual fix; the email/phone inputs are cosmetic
 * without it.
 *
 * This logic existed, correctly, inside `admin/jobs/new/page.tsx`'s own local
 * server action and NOWHERE ELSE, which is why the same booking made through
 * JobModal (the Jobs page's "+ New job", the calendar create flow, every Edit
 * button) came out contactless. It lives here so both paths call one
 * implementation — the same reason `client-address-store.ts` exists.
 *
 * Not in `actions/saveJob.ts`: every export of a "use server" module becomes a
 * network-callable server action, and this takes a caller-supplied clientId.
 */

import { db } from "@/db";

export interface JobClientCapture {
  /** Already-linked client, from the form's hidden field / picker. */
  clientId?: string | null;
  clientName?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  /** The job's service address — seeds the new profile's flat address. */
  address?: string | null;
  aptNumber?: string | null;
  postalCode?: string | null;
}

const clean = (s?: string | null) => {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : null;
};

/** Digits only, last 10 — "(514) 555-0199", "514-555-0199" and "15145550199"
 *  all collapse to the same key. Under 7 digits is too weak to match on. */
function phoneKey(raw?: string | null): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

/**
 * Resolve the `Client` a job belongs to, creating the profile when the admin
 * typed a brand-new customer.
 *
 *  • An explicit `clientId` (picked from the typeahead) always wins — it is
 *    never second-guessed against the typed contact details.
 *  • Otherwise dedupe by email or phone before creating anything, so booking a
 *    returning customer whose name was retyped links to the profile that
 *    already exists instead of forking it.
 *  • With neither an email nor a phone there is nothing safe to match on, so a
 *    new profile is created — two walk-ins can genuinely share a name, and the
 *    Contacts → Manage Duplicates flow is the tool for the rest.
 *
 * Returns `{ clientId: null }` when there is no name to create from; callers
 * fall back to the free-text `clientName` exactly as before.
 */
export async function resolveJobClient(
  input: JobClientCapture
): Promise<{ clientId: string | null; created: boolean }> {
  const linkedId = clean(input.clientId);
  if (linkedId) return { clientId: linkedId, created: false };

  const name = clean(input.clientName);
  if (!name) return { clientId: null, created: false };

  const email = clean(input.clientEmail);
  const phone = clean(input.clientPhone);

  // 1 — exact-ish match the database can do itself.
  if (email || phone) {
    const matched = await db.client.findFirst({
      where: {
        deletedAt: null,
        OR: [
          ...(email
            ? [{ email: { equals: email, mode: "insensitive" as const } }]
            : []),
          ...(phone ? [{ phone }] : []),
        ],
      },
      select: { id: true },
    });
    if (matched) return { clientId: matched.id, created: false };
  }

  // 2 — same number, different punctuation. Stored phones are free text
  // ("(514) 555-0199" vs "5145550199"), so an exact comparison misses the
  // customer it was meant to find. Only runs when step 1 came up empty.
  const key = phoneKey(phone);
  if (key) {
    const candidates = await db.client.findMany({
      where: { deletedAt: null, phone: { not: null } },
      select: { id: true, phone: true },
      take: 5000,
    });
    const hit = candidates.find((c) => phoneKey(c.phone) === key);
    if (hit) return { clientId: hit.id, created: false };
  }

  const created = await db.client.create({
    data: {
      name,
      email,
      phone,
      address: clean(input.address),
      aptNumber: clean(input.aptNumber),
      // The flat trio on Client is the customer's own address; seeding it from
      // the first job they booked is what the full-page form has always done.
      zip: clean(input.postalCode),
    },
    select: { id: true },
  });
  return { clientId: created.id, created: true };
}
