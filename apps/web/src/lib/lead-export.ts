/**
 * "Export hot leads to contact records" — client feedback item 19, Stage 11.1.
 *
 *   "It would also be nice if we could export these hot leads to our contact
 *    records, so that way they're never lost leads, whatever information we
 *    have on them we'll take. Just add a button for that."
 *
 * Three outcomes per lead, never a fourth:
 *   created — nobody in the CRM matches; a Contact is created from the lead.
 *   linked  — a contact already exists for this person (email or phone). It is
 *             attached to the lead where the link slot is free, and any field
 *             the contact is MISSING is filled in from the lead. Nothing that
 *             already has a value is overwritten.
 *   skipped — the CRM already holds this lead. Nothing is written at all.
 *
 * Which makes the whole thing idempotent: re-running it creates nothing,
 * because every lead it touched now resolves to a contact. That is the
 * "marks the lead as exported so re-export can't duplicate" requirement, met by
 * the CRM's own identity rules rather than a flag that would go stale the
 * moment a contact is merged or archived.
 *
 * Not in the `"use server"` action, for the reason `client-capture.ts` gives:
 * every export of a "use server" module becomes a network-callable endpoint,
 * and this one takes a caller-supplied actor name. The action is the gate; this
 * is the work, and it can be exercised directly by a test.
 */

import { db } from "@/lib/org-db";
import type { LeadStatus, LifecycleStage, Prisma } from "@prisma/client";
import { formatDate } from "@/lib/timezone";
import {
  buildContactMatchIndex,
  indexContact,
  matchLead,
  normEmail,
  type LeadContactRef,
} from "@/lib/lead-contacts";

export interface LeadExportResult {
  created: number;
  linked: number;
  skipped: number;
  /** Set when exactly one lead was processed — lets the UI deep-link to it. */
  contactId?: string;
  /**
   * leadId → the contact it now resolves to, for each lead this run processed.
   * The same shape `findContactsForLeads` gives the page loader, so the Leads
   * table can flip a row to "In contacts" the moment the export returns instead
   * of waiting for `router.refresh()`. Resolved here rather than re-derived in
   * the browser for the reason at the top of `lead-contacts.ts`: one
   * implementation of "is this lead already in the CRM?", so the button and the
   * row can't disagree.
   */
  contacts: Record<string, LeadContactRef>;
}

/**
 * Lead status → CRM lifecycle. Deliberately the same map the `contacts_crm`
 * migration used for its one-time backfill, so a lead exported by this button
 * lands in the same stage as the 12 leads that migration already imported.
 *
 * CONVERTED is the one addition. The migration skipped converted leads on the
 * grounds that "converted leads are covered by their Client row" — but
 * `convertLeadToJob` creates the job with `clientId: null` and no Client at
 * all, so those leads have neither a contact nor a client. On live data that is
 * 18 of 32 leads: the largest single group, and exactly the "lost leads" the
 * request is about.
 */
export const LIFECYCLE_BY_LEAD_STATUS: Record<LeadStatus, LifecycleStage> = {
  NEW: "NEW_LEAD",
  CONTACTED: "QUALIFIED",
  CONVERTED: "BOOKED",
  DEAD: "LOST",
  OUT_OF_AREA: "LOST",
};

export const LEAD_EXPORT_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  postalCode: true,
  status: true,
  source: true,
  serviceType: true,
  bedCount: true,
  bathCount: true,
  halfBathCount: true,
  squareFootage: true,
  preferredDate: true,
  isFlexible: true,
  preferredSlot: true,
  dropOffStep: true,
  createdAt: true,
} as const;

export type ExportableLead = Prisma.LeadGetPayload<{ select: typeof LEAD_EXPORT_SELECT }>;

const clean = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : null;
};

/** Everything the lead knows that has nowhere else to live on a Contact —
 *  "whatever information we have on them we'll take". */
export function leadSummary(lead: ExportableLead): string {
  const bits: string[] = [];
  if (lead.serviceType) bits.push(`Service: ${lead.serviceType}`);
  if (lead.postalCode) bits.push(`Postal: ${lead.postalCode}`);
  const rooms = [
    lead.bedCount != null ? `${lead.bedCount} bed` : null,
    lead.bathCount != null ? `${lead.bathCount} bath` : null,
    lead.halfBathCount ? `${lead.halfBathCount} half-bath` : null,
  ].filter(Boolean);
  if (rooms.length) bits.push(rooms.join(", "));
  if (lead.squareFootage != null) bits.push(`${lead.squareFootage} sq ft`);
  if (lead.preferredDate) {
    bits.push(
      `Preferred: ${formatDate(lead.preferredDate, { month: "short", day: "numeric", year: "numeric" })}` +
        (lead.isFlexible ? " (flexible)" : lead.preferredSlot ? ` ${lead.preferredSlot}` : "")
    );
  }
  if (lead.dropOffStep != null) bits.push(`Stopped at step ${lead.dropOffStep}`);
  bits.push(`Lead source: ${lead.source ?? "unknown"}`);
  bits.push(
    `Captured ${formatDate(lead.createdAt, { month: "short", day: "numeric", year: "numeric" })}`
  );
  return bits.join(" · ");
}

/** The property-bag keys the contact record actually renders (CONTACT_BINDINGS
 *  in lib/crm-meta.ts). Anything else the lead carries goes into the timeline
 *  note instead of into a props key nothing displays. */
export function leadProps(lead: ExportableLead): Prisma.InputJsonValue | undefined {
  const props: Record<string, number> = {};
  if (lead.bedCount != null) props.bedrooms = lead.bedCount;
  if (lead.bathCount != null) props.bathrooms = lead.bathCount;
  if (lead.squareFootage != null) props.sqft = lead.squareFootage;
  return Object.keys(props).length ? props : undefined;
}

export async function runLeadExport(
  leadIds: string[],
  actor: string
): Promise<LeadExportResult> {
  const ids = [...new Set(leadIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (!ids.length) return { created: 0, linked: 0, skipped: 0, contacts: {} };

  const leads = await db.lead.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: LEAD_EXPORT_SELECT,
    // Oldest first: when several leads are the same person, the first one seen
    // creates the contact and the rest link to it, so the record's identity
    // comes from the earliest capture rather than whichever row sorted first.
    orderBy: { createdAt: "asc" },
  });
  if (!leads.length) return { created: 0, linked: 0, skipped: 0, contacts: {} };

  const index = await buildContactMatchIndex(leads);

  let created = 0;
  let linked = 0;
  let skipped = 0;
  let lastContactId: string | undefined;
  const contacts: Record<string, LeadContactRef> = {};

  for (const lead of leads) {
    const match = matchLead(index, lead);

    // Already on a contact by its own link — nothing to do.
    if (match?.linked) {
      skipped++;
      lastContactId = match.id;
      contacts[lead.id] = match;
      continue;
    }

    const email = normEmail(lead.email);
    const phone = clean(lead.phone);
    const name = clean(lead.name) || email || "Unnamed lead";

    // `Contact.leadId` is unique and the match index deliberately ignores
    // archived contacts, so the slot can be held by a record this export cannot
    // see (a merge loser). Writing the link blind would fail the whole batch on
    // a unique violation; getting the person into the CRM matters more than the
    // link does.
    const linkHolder = await db.contact.findFirst({
      where: { leadId: lead.id },
      select: { id: true },
    });
    const linkFree = !linkHolder;

    if (match) {
      // Same person, different Lead row. Attach the lead where the link slot is
      // free and top up blanks — never overwrite a value someone else put
      // there, which is the rule Stage 6 established for merges.
      const existing = await db.contact.findUnique({
        where: { id: match.id },
        select: { id: true, name: true, email: true, phone: true, address: true, leadId: true, props: true },
      });
      if (!existing) {
        skipped++;
        continue;
      }

      const filled: string[] = [];
      const data: Prisma.ContactUpdateInput = { lastActivityAt: new Date() };
      if (!existing.email && email) { data.email = email; filled.push("email"); }
      if (!existing.phone && phone) { data.phone = phone; filled.push("phone"); }
      if (!existing.address && lead.postalCode) { data.address = lead.postalCode; filled.push("postal code"); }
      const willLink = !existing.leadId && linkFree;
      if (willLink) data.lead = { connect: { id: lead.id } };
      const props = leadProps(lead);
      if (props && !existing.props) { data.props = props; filled.push("property details"); }

      lastContactId = existing.id;
      // Recorded before the early return below: whether or not there was
      // anything left to write, this lead is in the CRM and the row should say
      // so. `linked` is this lead's own answer, not the contact's — see
      // `matchLead`.
      contacts[lead.id] = { id: existing.id, name: existing.name, linked: willLink };

      // Nothing to attach and nothing to fill: the CRM already holds everything
      // this lead knows. Report it as skipped and write nothing — otherwise a
      // second "Export all" would stack a fresh timeline note on every contact
      // without changing a single value.
      if (!willLink && !filled.length) {
        skipped++;
        continue;
      }

      await db.$transaction(async (tx) => {
        const __t0 = await tx.contact.update({ where: { id: existing.id }, data });
        const __t1 = await tx.contactActivity.create({
            data: {
              contactId: existing.id,
              type: "NOTE",
              title: "Lead attached from Leads",
              body:
                leadSummary(lead) +
                (filled.length ? ` · Filled in: ${filled.join(", ")}` : " · Nothing was missing"),
              actor,
            },
          });
        return [__t0, __t1];
      });

      linked++;
      indexContact(index, {
        id: existing.id,
        name: existing.name,
        email: existing.email ?? email,
        phone: existing.phone ?? phone,
        leadId: existing.leadId ?? (willLink ? lead.id : null),
      });
      continue;
    }

    const contact = await db.contact.create({
      data: {
        name,
        email,
        phone,
        // The lead only ever knows a postal code; it is still the one piece of
        // location the CRM can search and score duplicates on.
        address: clean(lead.postalCode),
        lifecycle: LIFECYCLE_BY_LEAD_STATUS[lead.status] ?? "NEW_LEAD",
        source: clean(lead.source) ?? "Booking form",
        latestSource: clean(lead.source) ?? "Booking form",
        props: leadProps(lead),
        ...(linkFree ? { leadId: lead.id } : {}),
        lastActivityAt: new Date(),
        activities: {
          create: {
            type: "CREATE",
            title: "Exported from lead",
            body: leadSummary(lead),
            actor,
          },
        },
      },
      select: { id: true, name: true, email: true, phone: true, leadId: true },
    });

    created++;
    lastContactId = contact.id;
    contacts[lead.id] = { id: contact.id, name: contact.name, linked: linkFree };
    // Feed it back into the index so the same person's OTHER leads in this same
    // batch link to it instead of creating a second copy. Live data has one
    // email address on nine separate leads — without this, one click of
    // "Export all" would file nine contacts for one person.
    indexContact(index, contact);
  }

  return {
    created,
    linked,
    skipped,
    contacts,
    ...(leads.length === 1 && lastContactId ? { contactId: lastContactId } : {}),
  };
}
