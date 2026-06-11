"use client";

import { useState } from "react";
import {
  ArrowLeft, DollarSign, Briefcase, Star, CreditCard,
  AlertTriangle, Pencil, Mail, Phone, MapPin,
} from "lucide-react";
import ClientModal from "../ClientModal";
import ClientAddressManager from "../ClientAddressManager";

type TabKey = "history" | "payments" | "ratings";

interface ClientAddressLite {
  id: string;
  label: string;
  address: string;
  aptNumber: string | null;
  isDefault: boolean;
}

interface ClientData {
  id: string;
  name: string;
  email: string | null;
  secondaryEmail?: string | null;
  phone: string | null;
  secondaryPhone?: string | null;
  company?: string | null;
  address: string | null;
  aptNumber?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  notes: string | null;
  discountPercent: number;
  createdAt: string;
  addresses?: ClientAddressLite[];
}

interface JobLite {
  id: string;
  clientName: string;
  location: string | null;
  jobType: string | null;
  jobDate: string | null;
  startTime: string;
  endTime: string | null;
  status: string;
  price: number | null;
  employeePay: number | null;
  totalTip: number | null;
  parking: number | null;
  paymentReceived: boolean;
  invoiceSent: boolean;
  notes: string | null;
  paymentType: string | null;
  discountAmount: number | null;
  cleaners: Array<{ id: string; name: string }>;
}

interface Totals {
  totalRevenue: number;
  totalPaid: number;
  unpaidAmount: number;
  jobCount: number;
}

interface RatingEntry {
  id: string;
  rating: number;
  notes: string | null;
  ratedBy: string | null;
  createdAt: string;
  employee: { id: string; name: string };
  job: { id: string; jobNumber: number; jobDate: string | null } | null;
}

const AVATAR_COLORS = ["#005F6A", "#0284c7", "#7c3aed", "#dc2626", "#d97706", "#059669", "#0891b2", "#be185d"];

function avatarColor(name: string) {
  return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
}
function initials(name: string) {
  return name.split(" ").slice(0, 2).map(p => p[0] ?? "").join("").toUpperCase();
}

const STATUS_PILLS: Record<string, { bg: string; fg: string; dot: string; label: string }> = {
  CREATED:     { bg: "rgba(148,163,184,0.18)", fg: "#475569", dot: "#94a3b8", label: "Created" },
  SCHEDULED:   { bg: "rgba(217,119,6,0.12)",   fg: "#92400e", dot: "#d97706", label: "Scheduled" },
  IN_PROGRESS: { bg: "rgba(2,132,199,0.10)",   fg: "#075985", dot: "#0284c7", label: "In Progress" },
  COMPLETED:   { bg: "rgba(5,150,105,0.10)",   fg: "#065f46", dot: "#10b981", label: "Completed" },
  PAID:        { bg: "rgba(5,150,105,0.18)",   fg: "#065f46", dot: "#059669", label: "Paid" },
  CANCELLED:   { bg: "rgba(220,38,38,0.10)",   fg: "#991b1b", dot: "#dc2626", label: "Cancelled" },
};

function StatusPill({ status }: { status: string }) {
  const c = STATUS_PILLS[status] ?? { bg: "var(--primary-10)", fg: "var(--primary)", dot: "var(--primary)", label: status };
  return (
    <span className="pill" style={{ background: c.bg, color: c.fg }}>
      <span className="pill-dot" style={{ background: c.dot }} />
      {c.label}
    </span>
  );
}

function StarRow({ rating }: { rating: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map(s => (
        <Star
          key={s}
          size={13}
          style={{ color: s <= Math.round(rating) ? "#f59e0b" : "#e5e7eb", fill: s <= Math.round(rating) ? "#f59e0b" : "#e5e7eb" }}
        />
      ))}
    </span>
  );
}

function AStatCard({ icon: Icon, label, value, hint, warn }: {
  icon: React.ElementType; label: string; value: string; hint?: string; warn?: boolean;
}) {
  return (
    <div className="astat" style={warn ? { borderLeft: "3px solid #d97706" } : {}}>
      <div className="astat-head" style={warn ? { color: "#92400e" } : {}}>
        <span>{label}</span>
        <span className="astat-icon" style={warn ? { background: "#fffbeb", color: "#d97706" } : {}}>
          <Icon size={15} />
        </span>
      </div>
      <div className="astat-value" style={warn ? { color: "#92400e" } : {}}>{value}</div>
      {hint && <div className="astat-delta">{hint}</div>}
    </div>
  );
}

function dateStr(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="stack-4">
      <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--primary-50)" }}>
        {label}
      </span>
      <span style={{ fontSize: 14, color: "var(--primary-80)" }}>{value}</span>
    </div>
  );
}

export default function ClientDetailView({
  client,
  jobs,
  totals,
  ratings = [],
}: {
  client: ClientData;
  jobs: JobLite[];
  totals: Totals;
  ratings?: RatingEntry[];
}) {
  const [tab, setTab] = useState<TabKey>("history");
  const [editOpen, setEditOpen] = useState(false);

  const avgRating = ratings.length
    ? (ratings.reduce((s, r) => s + r.rating, 0) / ratings.length)
    : null;

  const collectedPct = totals.totalRevenue > 0
    ? Math.round((totals.totalPaid / totals.totalRevenue) * 100)
    : 0;

  return (
    <div className="admin-font stack-24">
      <a href="/clients" className="link-muted" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
        <ArrowLeft size={14} /> Back to Clients
      </a>

      {/* Header */}
      <div className="row-between" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span
            className="avatar-lg avatar"
            style={{ background: avatarColor(client.name), fontSize: 18, flexShrink: 0 }}>
            {initials(client.name)}
          </span>
          <div className="stack-8">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 className="display" style={{ fontSize: "clamp(24px,3vw,36px)" }}>{client.name}</h1>
              {client.discountPercent > 0 && (
                <span className="pill" style={{ background: "#fffbeb", color: "#92400e" }}>
                  <span className="pill-dot" style={{ background: "#d97706" }} />
                  {client.discountPercent}% discount
                </span>
              )}
            </div>
            <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
              {client.email && (
                <a href={`mailto:${client.email}`} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--primary-70)", textDecoration: "none" }}>
                  <Mail size={13} /> {client.email}
                </a>
              )}
              {client.secondaryEmail && (
                <a href={`mailto:${client.secondaryEmail}`} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--primary-50)", textDecoration: "none" }}>
                  <Mail size={12} /> {client.secondaryEmail}
                </a>
              )}
              {client.phone && (
                <a href={`tel:${client.phone}`} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--primary-70)", textDecoration: "none" }}>
                  <Phone size={13} /> {client.phone}
                </a>
              )}
              {client.secondaryPhone && (
                <a href={`tel:${client.secondaryPhone}`} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--primary-50)", textDecoration: "none" }}>
                  <Phone size={12} /> {client.secondaryPhone}
                </a>
              )}
              {client.address && (
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--primary-70)" }}>
                  <MapPin size={13} /> {client.address}
                </span>
              )}
            </div>
          </div>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditOpen(true)}>
          <Pencil size={14} /> Edit Client
        </button>
      </div>

      {/* Stats */}
      <div className="astat-grid">
        <AStatCard icon={Briefcase}  label="Total jobs"  value={String(totals.jobCount)} />
        <AStatCard icon={DollarSign} label="Revenue"     value={`$${totals.totalRevenue.toFixed(0)}`} />
        <AStatCard
          icon={CreditCard} label="Collected"
          value={`$${totals.totalPaid.toFixed(0)}`}
          hint={`${collectedPct}% collected`}
        />
        <AStatCard
          icon={AlertTriangle} label="Unpaid"
          value={`$${totals.unpaidAmount.toFixed(0)}`}
          warn={totals.unpaidAmount > 0}
          hint={totals.unpaidAmount > 0 ? "outstanding" : "all clear"}
        />
      </div>

      {/* Contact & address details */}
      {(client.company || client.address || client.aptNumber || client.city || client.state || client.zip) && (
        <div className="dcard">
          <div className="dcard-head">
            <h3>Contact &amp; address</h3>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 16 }}>
            {client.company && <DetailRow label="Company" value={client.company} />}
            {client.address && <DetailRow label="Address" value={client.address} />}
            {client.aptNumber && <DetailRow label="Apt / Unit" value={client.aptNumber} />}
            {client.city && <DetailRow label="City" value={client.city} />}
            {client.state && <DetailRow label="State / Province" value={client.state} />}
            {client.zip && <DetailRow label="Zip / Postal" value={client.zip} />}
          </div>
        </div>
      )}

      {/* Notes */}
      {client.notes && (
        <div className="dcard">
          <div className="dcard-head">
            <h3>Notes</h3>
          </div>
          <p style={{ fontSize: 14, color: "var(--primary-70)", lineHeight: 1.6, margin: 0, whiteSpace: "pre-wrap" }}>
            {client.notes}
          </p>
        </div>
      )}

      {/* Saved Addresses */}
      <div className="dcard">
        <div className="dcard-head">
          <h3>Saved addresses</h3>
        </div>
        <ClientAddressManager clientId={client.id} addresses={client.addresses ?? []} />
      </div>

      {/* Tabs */}
      <div className="dtabs">
        <button
          type="button"
          className={`dtab ${tab === "history" ? "active" : ""}`}
          onClick={() => setTab("history")}>
          <Briefcase size={14} />
          Job history
          {jobs.length > 0 && <span className="atab-count">{jobs.length}</span>}
        </button>
        <button
          type="button"
          className={`dtab ${tab === "payments" ? "active" : ""}`}
          onClick={() => setTab("payments")}>
          <CreditCard size={14} />
          Payments
        </button>
        <button
          type="button"
          className={`dtab ${tab === "ratings" ? "active" : ""}`}
          onClick={() => setTab("ratings")}>
          <Star size={14} />
          Ratings
          {ratings.length > 0 && <span className="atab-count">{ratings.length}</span>}
        </button>
      </div>

      {/* Job History */}
      {tab === "history" && (
        jobs.length === 0 ? (
          <div className="atable-wrap" style={{ padding: "60px 40px", textAlign: "center", color: "var(--primary-60)" }}>
            No jobs recorded for this client.
          </div>
        ) : (
          <div className="atable-wrap">
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th className="num">Price</th>
                    <th>Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map(j => {
                    const d = j.jobDate || j.startTime;
                    return (
                      <tr key={j.id} onClick={() => { window.location.href = `/jobs/${j.id}`; }}>
                        <td className="col-date" style={{ minWidth: 130 }}>
                          <div className="date-line">{dateStr(d)}</div>
                        </td>
                        <td>
                          {j.jobType ? (
                            <span className="pill" style={{ background: "var(--primary-10)", color: "var(--primary)" }}>
                              {j.jobType}
                            </span>
                          ) : <span style={{ color: "var(--primary-40)" }}>—</span>}
                        </td>
                        <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", fontSize: 12, color: "var(--primary-70)" }}>
                          {j.location || "—"}
                        </td>
                        <td><StatusPill status={j.status} /></td>
                        <td className="num" style={{ fontWeight: 600, color: "var(--ink)" }}>
                          {j.price ? `$${j.price.toFixed(0)}` : "—"}
                        </td>
                        <td>
                          <span className="pay-icons">
                            <span className={`pay-icon ${j.paymentReceived ? "paid" : "unpaid"}`} title={j.paymentReceived ? "Paid" : "Unpaid"}>$</span>
                            <span className={`pay-icon ${j.invoiceSent ? "sent" : "unsent"}`} title={j.invoiceSent ? "Invoice sent" : "No invoice"}>✉</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* Payments */}
      {tab === "payments" && (() => {
        const paid = jobs.filter(j => j.paymentReceived);
        return paid.length === 0 ? (
          <div className="atable-wrap" style={{ padding: "60px 40px", textAlign: "center", color: "var(--primary-60)" }}>
            No payments recorded.
          </div>
        ) : (
          <div className="atable-wrap">
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Job</th>
                    <th className="num">Amount</th>
                    <th>Payment type</th>
                    <th>Received</th>
                  </tr>
                </thead>
                <tbody>
                  {paid.map(j => {
                    const d = j.jobDate || j.startTime;
                    return (
                      <tr key={j.id} onClick={() => { window.location.href = `/jobs/${j.id}`; }}>
                        <td className="col-date" style={{ minWidth: 130 }}>
                          <div className="date-line">{dateStr(d)}</div>
                        </td>
                        <td>
                          <a href={`/jobs/${j.id}`} className="link" onClick={e => e.stopPropagation()} style={{ fontSize: 13 }}>
                            View job
                          </a>
                        </td>
                        <td className="num" style={{ fontWeight: 600, color: "#059669" }}>
                          +${(j.price || 0).toFixed(0)}
                        </td>
                        <td>
                          {j.paymentType ? (
                            <span className="pill" style={{ background: "var(--primary-10)", color: "var(--primary)" }}>
                              {j.paymentType}
                            </span>
                          ) : <span style={{ color: "var(--primary-40)" }}>—</span>}
                        </td>
                        <td>
                          <span className="pay-icon paid">✓</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Ratings */}
      {tab === "ratings" && (
        ratings.length === 0 ? (
          <div className="atable-wrap" style={{ padding: "60px 40px", textAlign: "center", color: "var(--primary-60)" }}>
            <Star size={32} style={{ color: "var(--primary-30)", margin: "0 auto 12px" }} />
            <p style={{ margin: 0 }}>No ratings yet for this client.</p>
            <p style={{ margin: "6px 0 0", fontSize: 12 }}>Ratings are submitted by clients via the post-job review link.</p>
          </div>
        ) : (
          <div className="stack-16">
            {/* Rating hero */}
            <div style={{
              background: "linear-gradient(135deg, #004952 0%, #005F6A 60%, #007a88 100%)",
              borderRadius: 16, padding: "28px 32px",
              display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap",
            }}>
              <div>
                <div style={{ fontFamily: "var(--font-serif)", fontSize: 52, fontWeight: 400, color: "#fff", lineHeight: 1 }}>
                  {avgRating!.toFixed(1)}
                </div>
                <StarRow rating={avgRating!} />
              </div>
              <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 14 }}>
                {ratings.length} review{ratings.length !== 1 ? "s" : ""}
              </div>
            </div>

            {ratings.map(r => (
              <div key={r.id} className="dcard">
                <div className="dcard-head">
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="avatar" style={{ background: avatarColor(r.employee.name), fontSize: 11, width: 32, height: 32 }}>
                      {initials(r.employee.name)}
                    </span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{r.employee.name}</div>
                      {r.job && (
                        <a href={`/jobs/${r.job.id}`} className="link-muted" style={{ fontSize: 11 }}>
                          Job #{r.job.jobNumber}{r.job.jobDate ? ` · ${dateStr(r.job.jobDate)}` : ""}
                        </a>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <StarRow rating={r.rating} />
                    <div style={{ fontSize: 11, color: "var(--primary-50)", marginTop: 4 }}>
                      {dateStr(r.createdAt)}
                    </div>
                  </div>
                </div>
                {r.notes && (
                  <blockquote style={{
                    margin: 0, padding: "12px 16px",
                    borderLeft: "3px solid var(--primary-20)",
                    background: "var(--primary-5)",
                    borderRadius: "0 8px 8px 0",
                    fontSize: 13, color: "var(--primary-70)", fontStyle: "italic", lineHeight: 1.6,
                  }}>
                    {r.notes}
                  </blockquote>
                )}
              </div>
            ))}
          </div>
        )
      )}

      <ClientModal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        mode="edit"
        client={client}
      />
    </div>
  );
}
