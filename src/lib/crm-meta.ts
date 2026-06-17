// Client-safe CRM constants, types and formatters. No DB / server imports here
// so this can be pulled into client components. Server queries live in crm.ts.

import type { LifecycleStage, ContactActivityType } from "@prisma/client";

// ─── Lifecycle stages (each its own colour, mirrors the design handoff) ───
export type StageMeta = { label: string; bg: string; fg: string; dot: string };

export const LIFECYCLE_META: Record<LifecycleStage, StageMeta> = {
  NEW_LEAD:  { label: "New Lead",       bg: "rgba(2,132,199,0.10)",   fg: "#075985", dot: "#0284c7" },
  QUALIFIED: { label: "Qualified",      bg: "rgba(79,70,229,0.10)",   fg: "#3730a3", dot: "#4f46e5" },
  BOOKED:    { label: "Booked",         bg: "rgba(0,140,156,0.10)",    fg: "#003940", dot: "#008C9C" },
  ACTIVE:    { label: "Active",         bg: "rgba(5,150,105,0.12)",   fg: "#065f46", dot: "#059669" },
  RETURNING: { label: "Returning",      bg: "rgba(13,148,136,0.12)",  fg: "#115e59", dot: "#0d9488" },
  PAST:      { label: "Past",           bg: "rgba(100,116,139,0.12)", fg: "#334155", dot: "#64748b" },
  LOST:      { label: "Lost",           bg: "rgba(220,38,38,0.10)",   fg: "#b91c1c", dot: "#dc2626" },
  APPLICANT: { label: "Applicant",      bg: "rgba(217,119,6,0.12)",   fg: "#92400e", dot: "#d97706" },
  CLEANER:   { label: "Cleaner",        bg: "rgba(124,58,237,0.10)",  fg: "#5b21b6", dot: "#7c3aed" },
  DNC:       { label: "Do Not Contact", bg: "rgba(71,85,105,0.14)",   fg: "#1e293b", dot: "#475569" },
};

export const LIFECYCLE_ORDER: LifecycleStage[] = [
  "NEW_LEAD", "QUALIFIED", "BOOKED", "ACTIVE", "RETURNING",
  "PAST", "LOST", "APPLICANT", "CLEANER", "DNC",
];

/** Stages that count as "won" for conversion math. */
export const WON_STAGES: LifecycleStage[] = ["BOOKED", "ACTIVE", "RETURNING", "PAST", "CLEANER"];

// ─── Activity event types (mixed timeline) ───
export type EventMeta = { color: string; bg: string };

export const EVENT_META: Record<ContactActivityType, EventMeta> = {
  NOTE:      { color: "#64748b", bg: "rgba(100,116,139,0.12)" },
  EMAIL:     { color: "#0284c7", bg: "rgba(2,132,199,0.10)" },
  SMS:       { color: "#059669", bg: "rgba(5,150,105,0.12)" },
  CALL:      { color: "#0d9488", bg: "rgba(13,148,136,0.12)" },
  BOOKING:   { color: "#008C9C", bg: "rgba(0,140,156,0.10)" },
  RATING:    { color: "#d97706", bg: "rgba(217,119,6,0.12)" },
  CANCEL:    { color: "#dc2626", bg: "rgba(220,38,38,0.10)" },
  LIFECYCLE: { color: "#7c3aed", bg: "rgba(124,58,237,0.10)" },
  CREATE:    { color: "#94a3b8", bg: "rgba(148,163,184,0.14)" },
};

export const SOURCE_OPTIONS = [
  "Google", "Meta", "Instagram", "Facebook", "Referral", "Word of mouth", "Direct", "Organic search", "Other",
];

// ─── Serialized shapes returned by crm.ts (all dates are ISO strings) ───
export type CrmProps = Record<string, string | number | null>;

export type ContactListItem = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  lifecycle: LifecycleStage;
  source: string | null;
  sourceDetail: string | null;
  campaign: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerInitials: string | null;
  ownerColor: string | null;
  leadScore: number | null;
  nextStep: string | null;
  nextStepDue: string | null;
  tags: string[];
  bookings: number;
  lifetimeValue: number;
  ratingAvg: number | null;
  ratingCount: number;
  lastActivityAt: string;
  createdAt: string;
  duplicateIds: string[];
  props: CrmProps;
};

export type ActivityItem = {
  id: string;
  type: ContactActivityType;
  title: string;
  body: string | null;
  actor: string | null;
  ts: string;
};

export type BookingRow = {
  id: string;
  date: string;
  service: string;
  cleaner: string;
  status: string; // job status, lowercased for StatusPill
  amount: number;
  paid: boolean;
};

export type DuplicateCandidate = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  source: string | null;
  createdAt: string;
};

export type ContactDetail = ContactListItem & {
  activities: ActivityItem[];
  bookingRows: BookingRow[];
  duplicates: DuplicateCandidate[];
};

export type CrmStats = {
  total: number;
  newLeads7d: number;
  bookedThisMonth: number;
  convRate: number;
};

// ─── Manage Duplicates ───
export type DuplicateGroup = {
  id: string;
  members: ContactListItem[];
  matched: string[]; // subset of ["phone","email","address","name"]
  score: number;
  suggestedMasterId: string;
};

export const MATCH_LABELS: Record<string, string> = {
  phone: "Phone", email: "Email", address: "Address", name: "Name",
};

/** Fields the merge comparator lets the admin pick a winner for. */
export const MERGE_FIELDS: { k: string; label: string; mergeable: boolean }[] = [
  { k: "name", label: "Name", mergeable: true },
  { k: "email", label: "Email", mergeable: true },
  { k: "phone", label: "Phone", mergeable: true },
  { k: "address", label: "Address", mergeable: true },
  { k: "lifecycle", label: "Lifecycle", mergeable: true },
  { k: "source", label: "Original source", mergeable: true },
  { k: "owner", label: "Owner", mergeable: true },
  { k: "leadScore", label: "Lead score", mergeable: true },
  { k: "bookings", label: "Bookings", mergeable: false },
  { k: "ltv", label: "Lifetime value", mergeable: false },
  { k: "created", label: "Created", mergeable: false },
];

// ─── Formatters (UI) ───
export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export function money(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return "$" + Number(n).toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function dateStr(iso: string | null, opts: { year?: boolean } = {}): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: opts.year ? "numeric" : undefined,
  });
}

export function timeStr(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// ─── Property Engine → contact record binding ───
// How a registry property (by internal name) maps onto a Contact:
//  - "column"  → a real Contact column, editable via updateContactField
//  - "prop"    → a key in Contact.props JSON, editable via updateContactProp
//  - "system"  → computed/locked (rendered read-only on the record)
export type PropBinding = { kind: "column" | "prop" | "system"; key: string; numeric?: boolean };

export const CONTACT_BINDINGS: Record<string, PropBinding> = {
  email: { kind: "column", key: "email" },
  phone: { kind: "column", key: "phone" },
  address: { kind: "column", key: "address" },
  home_type: { kind: "prop", key: "homeType" },
  bedrooms: { kind: "prop", key: "bedrooms", numeric: true },
  bathrooms: { kind: "prop", key: "bathrooms", numeric: true },
  square_feet: { kind: "prop", key: "sqft", numeric: true },
  parking: { kind: "prop", key: "parking" },
  lifecycle: { kind: "system", key: "lifecycle" },
  source: { kind: "column", key: "source" },
  campaign: { kind: "column", key: "campaign" },
  lead_score: { kind: "system", key: "leadScore" },
  owner: { kind: "system", key: "owner" },
  frequency: { kind: "prop", key: "frequency" },
  preferred_cleaner: { kind: "prop", key: "preferredCleaner" },
  first_booked: { kind: "system", key: "firstBooked" },
  discount: { kind: "prop", key: "discount" },
  contact_id: { kind: "system", key: "id" },
  created_at: { kind: "system", key: "createdAt" },
  last_activity: { kind: "system", key: "lastActivity" },
};

/** Custom (admin-added) properties fall through to a props-bag binding. */
export function bindingFor(internalName: string): PropBinding {
  return CONTACT_BINDINGS[internalName] ?? { kind: "prop", key: internalName };
}
