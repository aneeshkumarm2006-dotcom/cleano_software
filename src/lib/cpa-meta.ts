// Client-safe CPA / lead-source constants, types and formatters.
// "True CPA" = ad spend ÷ first-cleaning customers (cost to acquire a paying
// customer, not just a booking). Organic channels carry no spend.

export type Channel = { id: string; name: string; paid: boolean; color: string };

export const CHANNELS: Channel[] = [
  { id: "google", name: "Google Ads", paid: true, color: "#005F6A" },
  { id: "instagram", name: "Instagram", paid: true, color: "#7c3aed" },
  { id: "facebook", name: "Facebook", paid: true, color: "#0284c7" },
  { id: "referral", name: "Referral", paid: false, color: "#059669" },
  { id: "wom", name: "Word of mouth", paid: false, color: "#0d9488" },
  { id: "direct", name: "Direct", paid: false, color: "#d97706" },
  { id: "other", name: "Other / Unattributed", paid: false, color: "#94a3b8" },
];

export const PAID_CHANNELS = CHANNELS.filter((c) => c.paid);

export function channelMeta(id: string): Channel {
  return CHANNELS.find((c) => c.id === id) ?? CHANNELS[CHANNELS.length - 1];
}

/** Map a free-text Contact.source onto a normalized channel id. */
export function channelFromSource(source: string | null | undefined): string {
  const s = (source || "").toLowerCase().trim();
  if (!s) return "other";
  if (s.includes("google")) return "google";
  if (s.includes("instagram") || s === "ig") return "instagram";
  if (s.includes("facebook") || s.includes("meta") || s === "fb") return "facebook";
  if (s.includes("referral")) return "referral";
  if (s.includes("word of mouth") || s === "wom") return "wom";
  if (s.includes("direct") || s.includes("website")) return "direct";
  return "other";
}

export type CpaRow = {
  id: string;
  name: string;
  paid: boolean;
  color: string;
  leads: number;
  booked: number;
  firstClean: number;
  returning: number;
  spend: number;
  conv: number;
  cpa: number | null;
  cpl: number | null;
  retRate: number;
};

export type CpaTotals = {
  spend: number;
  leads: number;
  booked: number;
  firstClean: number;
  returning: number;
  conv: number;
  cpa: number;
};

export type TrendPoint = { name: string; bookings: number; cpa: number };

export type SpendImport = {
  id: string;
  channel: string;
  channelName: string;
  date: string;
  amount: number;
  source: string | null;
};

export type CpaReport = {
  rows: CpaRow[];
  totals: CpaTotals;
  trend: TrendPoint[];
  imports: SpendImport[];
};

export function money(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return "$" + Number(n).toLocaleString("en-CA", { maximumFractionDigits: 0 });
}
export function money2(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "—";
  return "$" + Number(n).toFixed(2);
}
export function pct(n: number): string {
  return Math.round(n * 100) + "%";
}
