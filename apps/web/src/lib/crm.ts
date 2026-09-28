// Server-side CRM data layer. Aggregates the unified Contact table with the
// operational Client/Job rows it back-links to, and detects duplicates.
import "server-only";
import { db } from "@/lib/org-db";
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
  DuplicatePair,
  RejectedPair,
  DuplicatesPayload,
} from "@/lib/crm-meta";
import { WON_STAGES } from "@/lib/crm-meta";
import { scoreDuplicatePair } from "@/lib/similarity";

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
 *
 * TODO(client): the matching rules are hardcoded here (normalized phone of ≥7
 * digits, exact-match email). HubSpot exposes them as an editable rule list
 * ("HubSpot model (default)" + "Add new rule"); that panel is deliberately
 * phase 2 (Q3 item I) — the pair queue, the real similarity score and per-pair
 * rejection are what remove the confusion, and none of them need it.
 * Note the split: this is DETECTION (does a pair surface at all). Scoring, in
 * lib/similarity.ts, is what ranks the pairs once they have.
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

    await db.$transaction(async (tx) => {
      const __t0 = await tx.contactActivity.create({
          data: {
            contactId: contact.id,
            type: "BOOKING",
            title:
              event === "BOOKING_COMPLETED"
                ? "Booking completed"
                : "Booking created",
            actor: "System",
          },
        });
      const __t1 = await tx.contact.update({
          where: { id: contact.id },
          data: {
            ...(next !== contact.lifecycle ? { lifecycle: next } : {}),
            lastActivityAt: new Date(),
          },
        });
      return [__t0, __t1];
    });
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
    await db.$transaction(async (tx) => {
      const __t0 = await tx.contactActivity.create({
          data: {
            contactId: contact.id,
            type,
            title,
            body: body ?? null,
            actor: "System",
          },
        });
      const __t1 = await tx.contact.update({
          where: { id: contact.id },
          data: { lastActivityAt: new Date() },
        });
      return [__t0, __t1];
    });
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

// ─── Manage Duplicates: emit merge-ready PAIRS ───

/** Canonical id ordering — the same pair submitted either way round is one key. */
export function duplicatePairKey(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/**
 * Which of two records should survive a merge, by default. Unchanged heuristic
 * (most bookings → highest LTV → oldest), but it is no longer surfaced as
 * "master" jargon — the UI just shows Create date on both cards and lets the
 * per-property radios decide the outcome.
 */
function rankForKeep(a: ContactListItem, b: ContactListItem): number {
  return (
    b.bookings - a.bookings ||
    b.lifetimeValue - a.lifetimeValue ||
    +new Date(a.createdAt) - +new Date(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Detect duplicates and return them as pairs, plus the rejection backlog.
 *
 * Detection is unchanged in substance — contacts sharing a normalized phone
 * (≥7 digits) or an exact email, with `duplicateDismissed` records still
 * excluded so anything dismissed before Stage 6 stays hidden.
 *
 * PRESENTATION is what changed. Instead of one card per connected component
 * (which rendered 3, 5, N wrapping member tiles), each *match group* — the set
 * of contacts sharing one phone number or one email address — is anchored on
 * its best-ranked member and emitted as N−1 pairs against it. Merging is
 * transitive, so A+B then A+C lands where A+B+C would have, and the admin only
 * ever compares two records.
 *
 * Anchoring per match group rather than per component is deliberate: a
 * component can be a *chain* (a shares a phone with b, b shares an email with
 * c) where a and c have nothing in common, and a star on the component would
 * put those two side by side under a similarity score neither earned. Every
 * pair emitted here shares at least one real signal.
 */
export async function listDuplicatePairs(): Promise<DuplicatesPayload> {
  const checkedAt = new Date().toISOString();
  const [items, rejections] = await Promise.all([
    listContacts(),
    db.duplicateRejection.findMany({ orderBy: { rejectedAt: "desc" } }),
  ]);
  const byId = new Map(items.map((c) => [c.id, c]));

  const rejectedKeys = new Set(
    rejections.map((r) => duplicatePairKey(r.contactAId, r.contactBId).join("|"))
  );

  // Match groups: one bucket per shared phone, one per shared email. Only
  // contacts the duplicate index already flagged take part (that filter is
  // where `duplicateDismissed` is honoured).
  const buckets = new Map<string, ContactListItem[]>();
  const push = (key: string, c: ContactListItem) => {
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(c);
  };
  for (const c of items) {
    if (!c.duplicateIds.length) continue;
    const p = normPhone(c.phone);
    if (p.length >= 7) push(`phone:${p}`, c);
    const e = normEmail(c.email);
    if (e) push(`email:${e}`, c);
  }

  const pairs = new Map<string, DuplicatePair>();
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    const anchor = [...members].sort(rankForKeep)[0];
    for (const other of members) {
      if (other.id === anchor.id) continue;
      const [x, y] = duplicatePairKey(anchor.id, other.id);
      const key = `${x}|${y}`;
      if (rejectedKeys.has(key) || pairs.has(key)) continue;
      // Order within the pair by the keep heuristic, not by bucket anchoring,
      // so the same two records always default to the same survivor.
      const [keep, drop] = rankForKeep(anchor, other) <= 0 ? [anchor, other] : [other, anchor];
      const { score, matched } = scoreDuplicatePair(keep, drop);
      pairs.set(key, { id: `DP-${x}-${y}`, a: keep, b: drop, score, matched });
    }
  }

  const rejected: RejectedPair[] = [];
  for (const r of rejections) {
    const a = byId.get(r.contactAId);
    const b = byId.get(r.contactBId);
    // One side merged away or archived → nothing left to restore.
    if (!a || !b) continue;
    const [x, y] = duplicatePairKey(a.id, b.id);
    rejected.push({
      id: `DP-${x}-${y}`,
      ...(rankForKeep(a, b) <= 0 ? { a, b } : { a: b, b: a }),
      rejectedAt: r.rejectedAt.toISOString(),
      rejectedBy: r.rejectedBy,
    });
  }

  return {
    pairs: [...pairs.values()].sort((p, q) => q.score - p.score || p.a.name.localeCompare(q.a.name)),
    rejected,
    checkedAt,
  };
}
