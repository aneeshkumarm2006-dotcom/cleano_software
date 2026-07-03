// Server-side CRM data layer. Aggregates the unified Contact table with the
// operational Client/Job rows it back-links to, and detects duplicates.
import "server-only";
import { db } from "@/db";
import type { LifecycleStage, ContactActivityType } from "@prisma/client";
import { avatarColor, initials } from "@/lib/avatar";
import type {
  ContactListItem,
  ContactDetail,
  ActivityItem,
  BookingRow,
  DuplicateCandidate,
  CrmStats,
  CrmProps,
  DuplicateGroup,
} from "@/lib/crm-meta";
import { WON_STAGES } from "@/lib/crm-meta";

const PAID_STATUSES = ["PAID"] as const;

function normPhone(p: string | null | undefined): string {
  return (p || "").replace(/\D/g, "");
}
function normEmail(e: string | null | undefined): string {
  return (e || "").trim().toLowerCase();
}

type OwnerLite = { id: string; name: string };

async function ownerMap(ownerIds: (string | null)[]): Promise<Map<string, OwnerLite>> {
  const ids = [...new Set(ownerIds.filter((x): x is string => !!x))];
  const map = new Map<string, OwnerLite>();
  if (!ids.length) return map;
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  users.forEach((u) => map.set(u.id, u));
  return map;
}

/**
 * Build duplicate index across the whole contact set: contacts sharing a
 * normalized phone or exact email are flagged as candidates of one another.
 * Dismissed contacts are excluded.
 */
function buildDuplicateIndex(
  contacts: { id: string; phone: string | null; email: string | null; duplicateDismissed: boolean }[]
): Map<string, string[]> {
  const byPhone = new Map<string, string[]>();
  const byEmail = new Map<string, string[]>();
  for (const c of contacts) {
    if (c.duplicateDismissed) continue;
    const p = normPhone(c.phone);
    const e = normEmail(c.email);
    if (p.length >= 7) (byPhone.get(p) ?? byPhone.set(p, []).get(p)!).push(c.id);
    if (e) (byEmail.get(e) ?? byEmail.set(e, []).get(e)!).push(c.id);
  }
  const result = new Map<string, string[]>();
  const add = (groups: Map<string, string[]>) => {
    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      for (const id of ids) {
        const set = result.get(id) ?? result.set(id, []).get(id)!;
        for (const other of ids) if (other !== id && !set.includes(other)) set.push(other);
      }
    }
  };
  add(byPhone);
  add(byEmail);
  return result;
}

type ContactWithClient = Awaited<ReturnType<typeof fetchContactsRaw>>[number];

function fetchContactsRaw(archived = false) {
  return db.contact.findMany({
    where: { archivedAt: null, deletedAt: archived ? { not: null } : null },
    orderBy: { lastActivityAt: "desc" },
    include: {
      client: { select: { jobs: { select: { status: true, totalAmount: true, price: true } } } },
    },
  });
}

function aggregateJobs(client: ContactWithClient["client"]): { bookings: number; ltv: number } {
  const jobs = client?.jobs ?? [];
  const bookings = jobs.length;
  const ltv = jobs
    .filter((j) => (PAID_STATUSES as readonly string[]).includes(j.status))
    .reduce((sum, j) => sum + (j.totalAmount || j.price || 0), 0);
  return { bookings, ltv };
}

function toListItem(
  c: ContactWithClient,
  owners: Map<string, OwnerLite>,
  dupIndex: Map<string, string[]>
): ContactListItem {
  const { bookings, ltv } = aggregateJobs(c.client);
  const owner = c.ownerId ? owners.get(c.ownerId) : undefined;
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    address: c.address,
    lifecycle: c.lifecycle,
    source: c.source,
    sourceDetail: c.sourceDetail,
    campaign: c.campaign,
    ownerId: c.ownerId,
    ownerName: owner?.name ?? null,
    ownerInitials: owner ? initials(owner.name) : null,
    ownerColor: owner ? avatarColor(owner.name) : null,
    leadScore: c.leadScore,
    nextStep: c.nextStep,
    nextStepDue: c.nextStepDue ? c.nextStepDue.toISOString() : null,
    tags: c.tags,
    bookings: bookings || c.bookingsCount,
    lifetimeValue: ltv || c.lifetimeValue,
    ratingAvg: c.ratingAvg,
    ratingCount: c.ratingCount,
    lastActivityAt: c.lastActivityAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
    duplicateIds: dupIndex.get(c.id) ?? [],
    props: (c.props as CrmProps) ?? {},
  };
}

/**
 * CRM-006: keep the unified Contact in sync when the underlying Client record
 * is edited (by the customer in the portal or by an admin). Updates the linked
 * contact's identity fields + `lastActivityAt`. Best-effort and a no-op when no
 * contact is linked, so it never breaks the client-update flow.
 */
export async function syncContactFromClient(clientId: string): Promise<void> {
  try {
    const client = await db.client.findUnique({
      where: { id: clientId },
      select: { name: true, email: true, phone: true, address: true },
    });
    if (!client) return;
    const contact = await db.contact.findUnique({
      where: { clientId },
      select: { id: true },
    });
    if (!contact) return;
    await db.contact.update({
      where: { id: contact.id },
      data: {
        name: client.name,
        email: client.email ? client.email.toLowerCase() : null,
        phone: client.phone ?? null,
        address: client.address ?? null,
        lastActivityAt: new Date(),
      },
    });
  } catch (e) {
    console.error("syncContactFromClient", e);
  }
}

// §7 Lifecycle automation — promotion ranking. Higher = more advanced; we only
// ever move a contact forward (never downgrade on cancellations).
const LIFECYCLE_RANK: Record<LifecycleStage, number> = {
  NEW_LEAD: 0,
  QUALIFIED: 1,
  BOOKED: 2,
  ACTIVE: 3,
  RETURNING: 4,
  PAST: 1,
  LOST: 0,
  APPLICANT: 0,
  CLEANER: 5,
  DNC: 99,
};
// Manual/terminal stages automation must never override.
const FROZEN_LIFECYCLE = new Set<LifecycleStage>([
  "LOST",
  "DNC",
  "CLEANER",
  "APPLICANT",
]);

/**
 * §7: advance a client's linked contact on a booking event. Promotes lead →
 * BOOKED on create / → ACTIVE on completion (or → RETURNING if they've booked
 * before). Never downgrades, never touches frozen stages. Logs a BOOKING
 * activity. Best-effort — never throws into the booking flow.
 */
export async function advanceContactLifecycleForBooking(
  clientId: string,
  event: "BOOKING_CREATED" | "BOOKING_COMPLETED"
): Promise<void> {
  try {
    const contact = await db.contact.findUnique({
      where: { clientId },
      select: { id: true, lifecycle: true, bookingsCount: true },
    });
    if (!contact) return;

    let next: LifecycleStage = contact.lifecycle;
    if (!FROZEN_LIFECYCLE.has(contact.lifecycle)) {
      const target: LifecycleStage =
        contact.bookingsCount > 0
          ? "RETURNING"
          : event === "BOOKING_COMPLETED"
            ? "ACTIVE"
            : "BOOKED";
      if (
        (LIFECYCLE_RANK[target] ?? 0) > (LIFECYCLE_RANK[contact.lifecycle] ?? 0)
      ) {
        next = target;
      }
    }

    await db.$transaction([
      db.contactActivity.create({
        data: {
          contactId: contact.id,
          type: "BOOKING",
          title:
            event === "BOOKING_COMPLETED"
              ? "Booking completed"
              : "Booking created",
          actor: "System",
        },
      }),
      db.contact.update({
        where: { id: contact.id },
        data: {
          ...(next !== contact.lifecycle ? { lifecycle: next } : {}),
          lastActivityAt: new Date(),
        },
      }),
    ]);
  } catch (e) {
    console.error("advanceContactLifecycleForBooking", e);
  }
}

/**
 * §7: log a cancellation on the linked contact's timeline. Guardrail — it never
 * downgrades the lifecycle (a returning customer who cancels one visit stays
 * returning). Best-effort.
 */
export async function logContactEvent(
  clientId: string,
  type: ContactActivityType,
  title: string,
  body?: string
): Promise<void> {
  try {
    const contact = await db.contact.findUnique({
      where: { clientId },
      select: { id: true },
    });
    if (!contact) return;
    await db.$transaction([
      db.contactActivity.create({
        data: {
          contactId: contact.id,
          type,
          title,
          body: body ?? null,
          actor: "System",
        },
      }),
      db.contact.update({
        where: { id: contact.id },
        data: { lastActivityAt: new Date() },
      }),
    ]);
  } catch (e) {
    console.error("logContactEvent", e);
  }
}

export async function logContactCancellation(
  clientId: string,
  body: string
): Promise<void> {
  return logContactEvent(clientId, "CANCEL", "Cancellation", body);
}

export async function listContacts(archived = false): Promise<ContactListItem[]> {
  const raw = await fetchContactsRaw(archived);
  const owners = await ownerMap(raw.map((c) => c.ownerId));
  const dupIndex = buildDuplicateIndex(raw);
  return raw.map((c) => toListItem(c, owners, dupIndex));
}

export function computeStats(items: ContactListItem[]): CrmStats {
  const now = new Date();
  const total = items.length;
  const newLeads7d = items.filter(
    (c) => c.lifecycle === "NEW_LEAD" && Date.now() - new Date(c.createdAt).getTime() <= 7 * 86400000
  ).length;
  const bookedThisMonth = items.filter((c) => {
    if (!["BOOKED", "ACTIVE", "RETURNING"].includes(c.lifecycle)) return false;
    const d = new Date(c.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const leadsPool = items.filter((c) => !["APPLICANT", "CLEANER"].includes(c.lifecycle)).length;
  const won = items.filter((c) => WON_STAGES.includes(c.lifecycle)).length;
  const convRate = leadsPool ? Math.round((won / leadsPool) * 100) : 0;
  return { total, newLeads7d, bookedThisMonth, convRate };
}

function jobServiceLabel(jobType: string | null, location: string | null): string {
  if (jobType && jobType.trim()) return jobType;
  return location ? "Cleaning" : "Cleaning";
}

export async function getContact(id: string): Promise<ContactDetail | null> {
  const c = await db.contact.findUnique({
    where: { id },
    include: {
      activities: { orderBy: { createdAt: "desc" } },
      client: {
        select: {
          jobs: {
            orderBy: { startTime: "desc" },
            take: 10,
            select: {
              id: true,
              jobNumber: true,
              status: true,
              jobType: true,
              location: true,
              startTime: true,
              jobDate: true,
              totalAmount: true,
              price: true,
              employee: { select: { name: true } },
              cleaners: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!c) return null;

  // Resolve owner + duplicates against the full set (cheap; CRM is bounded).
  const all = await db.contact.findMany({
    where: { archivedAt: null },
    select: { id: true, name: true, email: true, phone: true, address: true, source: true, createdAt: true, duplicateDismissed: true },
  });
  const dupIndex = buildDuplicateIndex(all);
  const owners = await ownerMap([c.ownerId]);
  const owner = c.ownerId ? owners.get(c.ownerId) : undefined;

  const jobs = c.client?.jobs ?? [];
  const bookings: BookingRow[] = jobs.map((j) => {
    const cleaner = j.employee?.name || j.cleaners[0]?.name || "Unassigned";
    return {
      id: j.id,
      date: (j.startTime ?? j.jobDate ?? c.createdAt).toISOString(),
      service: jobServiceLabel(j.jobType, j.location),
      cleaner,
      status: j.status.toLowerCase().replace("_", ""),
      amount: j.totalAmount || j.price || 0,
      paid: j.status === "PAID",
    };
  });

  const activities: ActivityItem[] = c.activities.map((a) => ({
    id: a.id,
    type: a.type,
    title: a.title,
    body: a.body,
    actor: a.actor,
    ts: a.createdAt.toISOString(),
  }));
  // Always show at least a "created" event.
  if (!activities.length) {
    activities.push({
      id: "synthetic-create",
      type: "CREATE",
      title: "Contact created",
      body: c.sourceDetail ?? c.source ?? null,
      actor: owner?.name ?? "System",
      ts: c.createdAt.toISOString(),
    });
  }

  const dupCandidates: DuplicateCandidate[] = (dupIndex.get(c.id) ?? [])
    .map((dupId) => all.find((x) => x.id === dupId))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map((x) => ({
      id: x.id,
      name: x.name,
      email: x.email,
      phone: x.phone,
      address: x.address,
      source: x.source,
      createdAt: x.createdAt.toISOString(),
    }));

  const ltv = jobs.filter((j) => j.status === "PAID").reduce((s, j) => s + (j.totalAmount || j.price || 0), 0);

  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    address: c.address,
    lifecycle: c.lifecycle,
    source: c.source,
    sourceDetail: c.sourceDetail,
    campaign: c.campaign,
    ownerId: c.ownerId,
    ownerName: owner?.name ?? null,
    ownerInitials: owner ? initials(owner.name) : null,
    ownerColor: owner ? avatarColor(owner.name) : null,
    leadScore: c.leadScore,
    nextStep: c.nextStep,
    nextStepDue: c.nextStepDue ? c.nextStepDue.toISOString() : null,
    tags: c.tags,
    bookings: jobs.length || c.bookingsCount,
    lifetimeValue: ltv || c.lifetimeValue,
    ratingAvg: c.ratingAvg,
    ratingCount: c.ratingCount,
    lastActivityAt: c.lastActivityAt.toISOString(),
    createdAt: c.createdAt.toISOString(),
    duplicateIds: dupIndex.get(c.id) ?? [],
    props: (c.props as CrmProps) ?? {},
    activities,
    bookingRows: bookings,
    duplicates: dupCandidates,
  };
}

// ─── Manage Duplicates: group detected duplicates into merge candidates ───
function normAddr(a: string | null): string {
  return (a || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Form duplicate groups (connected components) from contacts sharing a
 * normalized phone or exact email — the same signal used for the per-record
 * duplicate flag. Returns groups of 2+ with matched-field labels, a confidence
 * score and a suggested master (most bookings → highest LTV → oldest).
 */
export async function listDuplicateGroups(): Promise<DuplicateGroup[]> {
  const items = await listContacts();
  const byId = new Map(items.map((c) => [c.id, c]));

  // Union-find over phone/email signals.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
  items.forEach((c) => parent.set(c.id, c.id));

  const link = (key: (c: ContactListItem) => string) => {
    const groups = new Map<string, string[]>();
    for (const c of items) {
      const k = key(c);
      if (!k) continue;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(c.id);
    }
    for (const ids of groups.values()) for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  };
  link((c) => (c.duplicateIds.length ? normPhone(c.phone) : "")); // only contacts already flagged
  link((c) => (c.duplicateIds.length ? normEmail(c.email) : ""));

  // Collect components of size >= 2.
  const comps = new Map<string, ContactListItem[]>();
  for (const c of items) {
    if (!c.duplicateIds.length) continue;
    const root = find(c.id);
    (comps.get(root) ?? comps.set(root, []).get(root)!).push(c);
  }

  const groups: DuplicateGroup[] = [];
  for (const members of comps.values()) {
    if (members.length < 2) continue;
    const sharesValue = (vals: string[]) => {
      const seen = new Map<string, number>();
      for (const v of vals) if (v) seen.set(v, (seen.get(v) ?? 0) + 1);
      return [...seen.values()].some((n) => n >= 2);
    };
    const matched: string[] = [];
    if (sharesValue(members.map((m) => normPhone(m.phone)))) matched.push("phone");
    if (sharesValue(members.map((m) => normEmail(m.email)))) matched.push("email");
    if (sharesValue(members.map((m) => normAddr(m.address)))) matched.push("address");
    if (sharesValue(members.map((m) => m.name.toLowerCase().trim()))) matched.push("name");

    const score = Math.min(98, 58 + matched.length * 13);
    const master = [...members].sort(
      (a, b) =>
        b.bookings - a.bookings ||
        b.lifetimeValue - a.lifetimeValue ||
        +new Date(a.createdAt) - +new Date(b.createdAt)
    )[0];
    const sortedIds = members.map((m) => m.id).sort();
    groups.push({
      id: `DG-${sortedIds[0]}`,
      members: members.sort((a, b) => (a.id === master.id ? -1 : b.id === master.id ? 1 : 0)),
      matched,
      score,
      suggestedMasterId: master.id,
    });
    void byId;
  }
  return groups.sort((a, b) => b.score - a.score);
}
