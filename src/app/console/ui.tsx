/**
 * The console's shared pieces: how a state, a seat count, a date and a sum of
 * money are drawn.
 *
 * Presentational only, and deliberately in one file. A status that reads
 * "Trialing" on one page and "Trial" on another, or a date written two ways, is
 * how an operator ends up mistrusting the screen.
 */
import type { WorkspaceRow } from "@/lib/console/queries";

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

export function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleDateString("en-CA", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toLocaleString("en-CA", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${n.toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Whole days from now. Negative means it already passed. */
export function daysUntil(d: Date): number {
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

export function ago(d: Date | null | undefined): string {
  if (!d) return "Never";
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return fmtDate(d);
}

type PillTone = "ok" | "trial" | "due" | "off" | "plain";

export function Pill({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

/**
 * One label for the state a workspace is actually in.
 *
 * Access comes first: a suspended workspace is suspended whatever its
 * subscription says, because that is what the people trying to work there
 * experience.
 */
export function workspaceState(w: WorkspaceRow): { tone: PillTone; label: string } {
  if (w.status === "SUSPENDED") return { tone: "off", label: "Suspended" };
  if (w.status === "CANCELLED") return { tone: "off", label: "Cancelled" };
  if (w.status === "PENDING") return { tone: "plain", label: "Not set up" };

  const sub = w.subscription;
  if (!sub) return { tone: "plain", label: "No subscription" };
  if (sub.status === "PAST_DUE") return { tone: "due", label: "Payment failed" };
  if (sub.status === "CANCELED") return { tone: "off", label: "Cancelled" };
  if (sub.status === "TRIALING") {
    if (!sub.trialEndsAt) return { tone: "trial", label: "Trial" };
    const left = daysUntil(sub.trialEndsAt);
    if (left < 0) return { tone: "due", label: "Trial expired" };
    return { tone: "trial", label: `Trial · ${left}d` };
  }
  return { tone: "ok", label: "Active" };
}

export function StatusPill({ w }: { w: WorkspaceRow }) {
  const { tone, label } = workspaceState(w);
  return <Pill tone={tone}>{label}</Pill>;
}

/**
 * Cleaners against the seat cap.
 *
 * Both a bar and the numbers: the bar answers "are they close?" at a glance, the
 * numbers answer "how close?" without arithmetic. An uncapped plan shows the
 * count alone rather than a bar that would always look empty.
 */
export function SeatMeter({ used, limit }: { used: number; limit: number | null }) {
  if (limit == null) {
    return (
      <div className="seats">
        <span>{used} / ∞</span>
      </div>
    );
  }
  const pct = limit === 0 ? 100 : Math.round((used / limit) * 100);
  const tone = pct >= 100 ? "full" : pct >= 90 ? "near" : "";
  return (
    <div className={`seats ${tone}`}>
      <div className="meter">
        <i style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span>
        {used} / {limit}
      </span>
    </div>
  );
}

/** When the money next moves, and whether that is a good or a bad thing. */
export function renewalCell(w: WorkspaceRow): { text: string; tone: string } {
  const sub = w.subscription;
  if (w.status === "SUSPENDED" || w.status === "CANCELLED") {
    return { text: "—", tone: "muted" };
  }
  if (!sub) return { text: "—", tone: "muted" };
  if (sub.status === "TRIALING" && sub.trialEndsAt) {
    return { text: `Ends ${fmtDate(sub.trialEndsAt)}`, tone: "warn-txt" };
  }
  if (sub.status === "PAST_DUE") {
    return { text: "Payment overdue", tone: "due-txt" };
  }
  if (sub.currentPeriodEnd) {
    return { text: `Renews ${fmtDate(sub.currentPeriodEnd)}`, tone: "muted" };
  }
  return { text: "—", tone: "muted" };
}

export function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/** A page's top strip. Every console page has one, so it lives here. */
export function TopBar({
  crumbs,
  tag,
  children,
}: {
  crumbs: React.ReactNode;
  tag?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="topbar">
      <div className="crumb">{crumbs}</div>
      {tag && <span className="envtag">{tag}</span>}
      <span className="spacer" />
      {children}
    </div>
  );
}
