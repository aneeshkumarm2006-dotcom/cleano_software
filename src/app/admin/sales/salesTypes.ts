// Shared sales-area type + campaign-status styling — single source of truth for
// the /sales redesign (used by SalesPageClient, SalesMapView, CampaignManager).
// Ported from the Cleano "Sales Leads" design handoff.

export const SALES_TYPE_LABELS: Record<string, string> = {
  DOOR_KNOCK: "Door Knock",
  FLYER_DROP: "Flyer Drop",
  REFERRAL: "Referral",
  ONLINE_AD: "Online Ad",
  SOCIAL_MEDIA: "Social Media",
  OTHER: "Other",
};

export const SALES_TYPE_COLORS: Record<string, string> = {
  DOOR_KNOCK: "#059669",
  FLYER_DROP: "#2f6fae",
  REFERRAL: "#d97706",
  ONLINE_AD: "#7c3aed",
  SOCIAL_MEDIA: "#0d7a86",
  OTHER: "#64748b",
};

export function salesTypeColor(type: string): string {
  return SALES_TYPE_COLORS[type] ?? SALES_TYPE_COLORS.OTHER;
}

export function salesTypeLabel(type: string): string {
  return SALES_TYPE_LABELS[type] ?? type;
}

export interface StatusStyle {
  label: string;
  dot: string;
  bg: string;
  fg: string;
}

// Campaign status (real enum: DRAFT/ACTIVE/PAUSED/COMPLETED).
export const CAMPAIGN_STATUS_STYLE: Record<string, StatusStyle> = {
  ACTIVE: { label: "Active", dot: "#059669", bg: "var(--emerald-100)", fg: "var(--emerald-800)" },
  PAUSED: { label: "Paused", dot: "#d97706", bg: "var(--amber-50)", fg: "var(--amber-800)" },
  COMPLETED: { label: "Completed", dot: "#64748b", bg: "var(--slate-100)", fg: "var(--slate-700)" },
  DRAFT: { label: "Draft", dot: "#2f6fae", bg: "var(--blue-100)", fg: "var(--blue-800)" },
};

export function campaignStatusStyle(status: string): StatusStyle {
  return CAMPAIGN_STATUS_STYLE[status] ?? CAMPAIGN_STATUS_STYLE.DRAFT;
}
