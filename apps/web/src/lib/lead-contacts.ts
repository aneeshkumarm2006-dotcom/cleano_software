/**
 * Lead → Contact matching (Stage 11.1, client feedback item 19 — "export these
 * hot leads to our contact records, so that way they're never lost leads").
 *
 * WHY A SHARED MODULE
 * Two surfaces need the same answer to "is this lead already in the CRM?": the
 * Leads page, which renders `In contacts ↗` instead of an export button, and
 * `exportLeadsToContacts`, which must never create a record the page said was
 * already there. One implementation, so the button can't lie.
 *
 * WHY MATCHING IS NOT JUST `Contact.leadId`
 * `Contact.leadId` is `@unique` — one contact can hold the link to exactly one
 * lead. Real lead data is nothing like that: on the live database one email
 * address owns **nine** separate Lead rows (`saveLead` only reuses a lead while
 * it is still NEW/CONTACTED, so every later funnel visit starts a new one).
 * Those nine are one person and belong on one contact, which means eight of
 * them can never hold the hard link. Identity therefore resolves on the same
 * signals the rest of the app dedupes on — email, and phone compared as digits,
 * because stored phones are free text ("(514) 555-0199" vs "5145550199").
 *
 * The measurement that made this the whole feature rather than a detail: of the
 * 20 live leads with no linked contact, **16 already exist in the CRM** under a
 * contact created some other way. A button that simply created one contact per
 * lead would have filed 16 duplicates — straight into the Manage Duplicates
 * queue the previous stage was built to drain.
 */

import "server-only";
import { db } from "@/lib/org-db";

/** The identity fields matching needs. Any lead row satisfies this. */
export interface LeadIdentity {
  id: string;
  email: string | null;
  phone: string | null;
}

export interface LeadContactRef {
  id: string;
  name: string;
  /**
   * `true`  — `Contact.leadId` points at this lead (a hard link).
   * `false` — resolved by email/phone. Same person, different Lead row; the
   *           link slot is taken by one of their other leads.
   */
  linked: boolean;
}

export function normEmail(e: string | null | undefined): string | null {
  const t = (e ?? "").trim().toLowerCase();
  return t.length > 0 ? t : null;
}

/** Digits only, last 10. Mirrors `phoneKey` in lib/client-capture.ts — under
 *  7 digits is too weak to identify anyone. */
export function phoneKey(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

/** In-memory index of the contacts a batch of leads could belong to. */
export interface ContactMatchIndex {
  byLeadId: Map<string, LeadContactRef>;
  byEmail: Map<string, LeadContactRef>;
  byPhone: Map<string, LeadContactRef>;
}

function emptyIndex(): ContactMatchIndex {
  return { byLeadId: new Map(), byEmail: new Map(), byPhone: new Map() };
}

/** Record a contact in the index so later leads in the same batch find it. */
export function indexContact(
  index: ContactMatchIndex,
  contact: { id: string; name: string; email: string | null; phone: string | null; leadId: string | null }
): void {
  const ref: LeadContactRef = { id: contact.id, name: contact.name, linked: false };
  if (contact.leadId) index.byLeadId.set(contact.leadId, { ...ref, linked: true });
  const e = normEmail(contact.email);
  if (e && !index.byEmail.has(e)) index.byEmail.set(e, ref);
  const p = phoneKey(contact.phone);
  if (p && !index.byPhone.has(p)) index.byPhone.set(p, ref);
}

/**
 * Resolve one lead against a built index. `linked` is decided here rather than
 * at index time: the same contact is a hard link for the one lead whose id it
 * carries and a soft match for that person's other leads, and the answer has to
 * come out different for each of them.
 */
export function matchLead(index: ContactMatchIndex, lead: LeadIdentity): LeadContactRef | null {
  const hard = index.byLeadId.get(lead.id);
  if (hard) return hard;
  const e = normEmail(lead.email);
  if (e) {
    const hit = index.byEmail.get(e);
    if (hit) return hit;
  }
  const p = phoneKey(lead.phone);
  if (p) {
    const hit = index.byPhone.get(p);
    if (hit) return hit;
  }
  return null;
}

/**
 * Build the match index for a set of leads. Two passes, mirroring the shape of
 * `resolveJobClient`: what the database can answer itself, then the loosened
 * phone comparison it can't (Postgres has no normalized-phone index here, and
 * adding one is a bigger change than this feature warrants).
 *
 * Archived and soft-deleted contacts are excluded — a lead whose only contact
 * was archived by a merge is genuinely not in the CRM any more, and offering to
 * re-export it is the right answer.
 */
export async function buildContactMatchIndex(leads: LeadIdentity[]): Promise<ContactMatchIndex> {
  const index = emptyIndex();
  if (!leads.length) return index;

  const leadIds = leads.map((l) => l.id);
  const emails = [...new Set(leads.map((l) => normEmail(l.email)).filter((e): e is string => !!e))];
  const phones = [...new Set(leads.map((l) => (l.phone ?? "").trim()).filter((p) => p.length > 0))];

  const direct = await db.contact.findMany({
    where: {
      archivedAt: null,
      deletedAt: null,
      OR: [
        { leadId: { in: leadIds } },
        ...emails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } })),
        ...(phones.length ? [{ phone: { in: phones } }] : []),
      ],
    },
    select: { id: true, name: true, email: true, phone: true, leadId: true },
  });
  for (const c of direct) indexContact(index, c);

  // Pass 2 — same number, different punctuation. Only for leads pass 1 left
  // unresolved, and only when they carry a phone worth matching on.
  const unresolvedKeys = new Set(
    leads
      .filter((l) => !matchLead(index, l))
      .map((l) => phoneKey(l.phone))
      .filter((k): k is string => !!k)
  );
  if (unresolvedKeys.size) {
    const candidates = await db.contact.findMany({
      where: { archivedAt: null, deletedAt: null, phone: { not: null } },
      select: { id: true, name: true, email: true, phone: true, leadId: true },
      take: 5000,
    });
    for (const c of candidates) {
      const key = phoneKey(c.phone);
      if (key && unresolvedKeys.has(key) && !index.byPhone.has(key)) {
        indexContact(index, c);
      }
    }
  }

  return index;
}

/** Convenience wrapper: leadId → the contact it resolves to, or absent. */
export async function findContactsForLeads(
  leads: LeadIdentity[]
): Promise<Map<string, LeadContactRef>> {
  const index = await buildContactMatchIndex(leads);
  const out = new Map<string, LeadContactRef>();
  for (const lead of leads) {
    const hit = matchLead(index, lead);
    if (hit) out.set(lead.id, hit);
  }
  return out;
}
