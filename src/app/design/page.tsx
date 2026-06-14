"use client";

/**
 * Internal design-system gallery — renders every admin UI atom on one page so
 * they can be reviewed and redesigned in one place. Ported from the Cleano
 * design handoff (Design System.html). Not in nav; visit /design directly.
 *
 * Canonical winners (one per duplicated primitive) are flagged with a teal
 * "Canonical" badge + the variants they replace.
 */

import { useState } from "react";
import { Search, SlidersHorizontal, Star, Check } from "lucide-react";
import { avatarColor, initials } from "@/lib/avatar";
import PageHeader from "@/components/ui/PageHeader";
import CanonSelect from "@/components/ui/CanonSelect";
import CleanoLoader from "@/components/ui/CleanoLoader";

const NAMES = ["Jane Doe", "Alex Morgan", "Riya Kapoor", "Sam Lee"];

function Canon() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "#fff",
        background: "var(--primary)",
        padding: "3px 9px",
        borderRadius: 999,
      }}>
      <Check size={11} strokeWidth={3.2} /> Canonical
    </span>
  );
}

function Replaces({ items }: { items: string[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 4 }}>
      <span style={{ fontSize: 11, color: "var(--primary-50)" }}>replaces</span>
      {items.map((it) => (
        <span
          key={it}
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 10.5,
            color: "var(--primary-60)",
            background: "var(--primary-5)",
            border: "1px solid var(--primary-10)",
            padding: "2px 7px",
            borderRadius: 6,
            textDecoration: "line-through",
            textDecorationColor: "var(--primary-30)",
          }}>
          {it}
        </span>
      ))}
    </div>
  );
}

function Section({
  title,
  cssRef,
  canon,
  children,
}: {
  title: string;
  cssRef: string;
  canon?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "#fff",
        borderRadius: 16,
        padding: 24,
        boxShadow: "var(--shadow-soft)",
        marginBottom: 20,
      }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 18,
          gap: 12,
          flexWrap: "wrap",
        }}>
        <div className="row" style={{ gap: 10 }}>
          <h2 className="title-sm">{title}</h2>
          {canon ? <Canon /> : null}
        </div>
        <code style={{ fontSize: 12, color: "var(--primary-50)" }}>{cssRef}</code>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        {children}
      </div>
    </section>
  );
}

export default function DesignGalleryPage() {
  const [tab, setTab] = useState("all");
  const [dtab, setDtab] = useState("overview");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sel1, setSel1] = useState("completed");
  const [sel2, setSel2] = useState("");

  return (
    <div className="admin-font" style={{ background: "var(--cream)", minHeight: "100vh", padding: "40px 32px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <header className="stack-8" style={{ marginBottom: 28 }}>
          <p className="eyebrow">Internal reference</p>
          <h1 className="display">
            Design <em>system.</em>
          </h1>
          <p className="subtitle">
            Every admin UI atom in one place. Canonical winners flagged. Defined in{" "}
            <code>globals.css</code> + <code>src/components/ui/</code>.
          </p>
        </header>

        {/* TYPOGRAPHY */}
        <Section title="Typography" cssRef=".eyebrow .display .subtitle .title-sm .text-*">
          <div className="stack-12" style={{ width: "100%" }}>
            <p className="eyebrow">Eyebrow label</p>
            <h1 className="display">Display heading <em>with emphasis</em></h1>
            <p className="subtitle">Subtitle — supporting copy under a heading.</p>
            <h3 className="title-sm">Title small (section heading)</h3>
            <div className="row" style={{ flexWrap: "wrap", gap: 16 }}>
              <span className="text-xl">text-xl</span>
              <span className="text-lg">text-lg</span>
              <span className="text-base">text-base</span>
              <span className="text-sm">text-sm</span>
              <span className="text-xs">text-xs</span>
              <span className="text-xxs">text-xxs</span>
              <span className="text-xxxs">text-xxxs</span>
            </div>
            <div className="row">
              <a className="link">Link</a>
              <a className="link-muted">Link muted</a>
            </div>
          </div>
        </Section>

        {/* BUTTONS */}
        <Section title="Buttons" cssRef=".btn .btn-primary/secondary/ghost/danger-ghost .btn-sm/lg" canon>
          <div className="stack-12" style={{ width: "100%" }}>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <button className="btn btn-primary">Primary</button>
              <button className="btn btn-secondary">Secondary</button>
              <button className="btn btn-ghost">Ghost</button>
              <button className="btn btn-danger-ghost">Danger ghost</button>
              <button className="btn btn-primary" disabled>Disabled</button>
              <button className="btn btn-primary btn-sm">Small</button>
              <button className="btn btn-primary btn-lg">Large</button>
              <button className="icon-btn" aria-label="icon"><Search size={16} /></button>
            </div>
            <Replaces items={["Button.tsx", ".act-*", "FilterStat"]} />
          </div>
        </Section>

        {/* PILLS */}
        <Section title="Status pills" cssRef=".pill .pill-emerald/amber/rose .pill-dot" canon>
          <div className="stack-12" style={{ width: "100%" }}>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <span className="pill pill-emerald"><span className="pill-dot" style={{ background: "currentColor" }} />Success</span>
              <span className="pill pill-amber"><span className="pill-dot" style={{ background: "currentColor" }} />Pending</span>
              <span className="pill pill-rose"><span className="pill-dot" style={{ background: "currentColor" }} />Failed</span>
              <span className="pill" style={{ background: "var(--primary-10)", color: "var(--primary-70)" }}>Neutral</span>
            </div>
            <Replaces items={["Badge.tsx", "STATUS_PILL", "inline hex"]} />
          </div>
        </Section>

        {/* AVATARS */}
        <Section title="Avatars" cssRef="avatarColor() · .avatar .avatar-lg .avstack" canon>
          <div className="stack-12" style={{ width: "100%" }}>
            <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
              <div className="row" style={{ gap: 8 }}>
                {NAMES.map((n) => (
                  <span key={n} className="avatar" style={{ background: avatarColor(n) }}>{initials(n)}</span>
                ))}
              </div>
              <span className="avatar avatar-lg" style={{ background: avatarColor(NAMES[0]) }}>{initials(NAMES[0])}</span>
              <div className="avstack">
                {NAMES.map((n) => (
                  <span key={n} className="avatar" style={{ background: avatarColor(n) }}>{initials(n)}</span>
                ))}
              </div>
            </div>
            <Replaces items={["3 hardcoded JS palettes"]} />
          </div>
        </Section>

        {/* DROPDOWN — CanonSelect */}
        <Section title="Dropdown (CanonSelect)" cssRef="src/components/ui/CanonSelect.tsx" canon>
          <div className="stack-12" style={{ width: "100%" }}>
            <div className="row" style={{ gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div className="stack-6">
                <span className="label">Basic + status dots</span>
                <CanonSelect
                  value={sel1}
                  onChange={setSel1}
                  options={[
                    { value: "upcoming", label: "Upcoming", dot: "var(--primary)" },
                    { value: "inprogress", label: "In progress", dot: "#d97706" },
                    { value: "completed", label: "Completed", dot: "#059669" },
                    { value: "cancelled", label: "Cancelled", dot: "#dc2626", disabled: true },
                  ]}
                />
              </div>
              <div className="stack-6">
                <span className="label">Searchable</span>
                <CanonSelect
                  value={sel2}
                  onChange={setSel2}
                  searchable
                  placeholder="Assign cleaner…"
                  options={NAMES.map((n) => ({ value: n, label: n }))}
                />
              </div>
            </div>
            <Replaces items={["Select", "PremiumSelect", "SearchableDropdown", "Dropdown", "custom-dropdown"]} />
          </div>
        </Section>

        {/* STAT TILES */}
        <Section title="Stat tiles" cssRef=".astat .astat-grid/head/icon/value/delta">
          <div className="astat-grid" style={{ width: "100%" }}>
            <div className="astat">
              <div className="astat-head"><span>Revenue</span><span className="astat-icon"><Star size={15} /></span></div>
              <div className="astat-value">$12,480</div>
              <div className="astat-delta up"><strong>+8.2%</strong> vs last week</div>
            </div>
            <div className="astat">
              <div className="astat-head"><span>Bookings</span><span className="astat-icon"><Star size={15} /></span></div>
              <div className="astat-value">142</div>
              <div className="astat-delta down"><strong>-3</strong> vs last week</div>
            </div>
            <div className="astat">
              <div className="astat-head"><span>Cleaners</span><span className="astat-icon"><Star size={15} /></span></div>
              <div className="astat-value">28</div>
              <div className="astat-delta"><strong>4</strong> on shift now</div>
            </div>
            <div className="astat">
              <div className="astat-head"><span>Rating</span><span className="astat-icon"><Star size={15} /></span></div>
              <div className="astat-value">4.9</div>
              <div className="astat-delta">from 1,204 reviews</div>
            </div>
          </div>
        </Section>

        {/* TABS */}
        <Section title="Segmented tabs" cssRef=".atabs .atab .atab-count">
          <div className="atabs">
            {[["all", "All", 500], ["success", "Success", 308], ["failed", "Failed", 188], ["pending", "Pending", 4]].map(
              ([key, label, count]) => (
                <button
                  key={key as string}
                  className={`atab ${tab === key ? "active" : ""}`}
                  onClick={() => setTab(key as string)}>
                  {label}
                  <span className="atab-count">{count}</span>
                </button>
              )
            )}
          </div>
        </Section>

        <Section title="Underline tabs" cssRef=".dtabs .dtab">
          <div className="dtabs">
            {[["overview", "Overview"], ["activity", "Activity"], ["billing", "Billing"]].map(([key, label]) => (
              <button
                key={key}
                className={`dtab ${dtab === key ? "active" : ""}`}
                onClick={() => setDtab(key)}>
                {label}
              </button>
            ))}
          </div>
        </Section>

        {/* TOOLBAR + FILTERS */}
        <Section title="Toolbar, search, select & filters" cssRef=".atoolbar .atoolbar-search .aselect .afilter-toggle .afilter-panel">
          <div className="stack-16" style={{ width: "100%" }}>
            <div className="atoolbar">
              <div className="atoolbar-search">
                <Search className="atoolbar-search-icon" size={16} />
                <input className="input" placeholder="Search…" />
              </div>
              <select className="aselect">
                <option>All categories</option>
                <option>Cron</option>
                <option>Email</option>
              </select>
              <button
                className={`afilter-toggle ${filtersOpen ? "open" : ""}`}
                onClick={() => setFiltersOpen((o) => !o)}>
                <SlidersHorizontal size={15} /> Filters <span className="afilter-badge">2</span>
              </button>
            </div>
            {filtersOpen ? (
              <div className="afilter-panel">
                <div className="field">
                  <label className="label">Status</label>
                  <select className="aselect"><option>Any</option></select>
                </div>
                <div className="field">
                  <label className="label">From</label>
                  <input className="input" type="date" />
                </div>
                <div className="field">
                  <label className="label">To</label>
                  <input className="input" type="date" />
                </div>
                <div className="field">
                  <label className="label">Search</label>
                  <input className="input" placeholder="Keyword" />
                </div>
                <div className="afilter-panel-actions">
                  <button className="btn btn-ghost btn-sm">Reset</button>
                  <button className="btn btn-primary btn-sm">Apply</button>
                </div>
              </div>
            ) : null}
          </div>
        </Section>

        {/* TABLE */}
        <Section title="Data table + pagination" cssRef=".atable-wrap .atable .apager">
          <div className="atable-wrap" style={{ width: "100%" }}>
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Date</th>
                    <th>Status</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2].map((i) => (
                    <tr key={i}>
                      <td>
                        <div className="row" style={{ gap: 10 }}>
                          <span className="avatar" style={{ background: avatarColor(NAMES[i]) }}>{initials(NAMES[i])}</span>
                          <div>
                            <div className="col-client">{NAMES[i]}</div>
                            <div className="col-client-sub">{["jane@…", "alex@…", "riya@…"][i]}</div>
                          </div>
                        </div>
                      </td>
                      <td className="col-date">
                        <div className="date-line">Jun 14</div>
                        <div className="time-line">2:00 PM</div>
                      </td>
                      <td>
                        <span className={`pill ${["pill-emerald", "pill-amber", "pill-rose"][i]}`}>
                          {["Paid", "Pending", "Failed"][i]}
                        </span>
                      </td>
                      <td className="num">${[180, 240, 120][i]}.00</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="apager">
              <span>Showing 1–3 of 142</span>
              <div className="apager-controls">
                <button className="apager-btn" disabled>‹</button>
                <button className="apager-btn active">1</button>
                <button className="apager-btn">2</button>
                <button className="apager-btn">3</button>
                <button className="apager-btn">›</button>
              </div>
            </div>
          </div>
        </Section>

        {/* CARDS */}
        <Section title="Cards" cssRef=".dcard .jcard" canon>
          <div className="stack-12" style={{ width: "100%" }}>
            <div className="grid-2">
              <div className="dcard">
                <div className="dcard-head">
                  <h3>Detail card (.dcard)</h3>
                  <button className="btn btn-ghost btn-sm">Edit</button>
                </div>
                <p className="subtitle" style={{ margin: 0 }}>Used on detail pages. 24px padding.</p>
              </div>
              <div className="jcard">
                <div className="jcard-top">
                  <div>
                    <div className="jcard-client">Job card (.jcard)</div>
                    <div className="jcard-meta">123 Main St · Deep clean</div>
                  </div>
                  <span className="pill pill-emerald">Scheduled</span>
                </div>
                <div className="jcard-row">
                  <span className="text-sm" style={{ color: "var(--primary-60)" }}>Jun 14, 2:00 PM</span>
                  <span className="jcard-price">$180</span>
                </div>
              </div>
            </div>
            <Replaces items={["Card.tsx", ".jcard"]} />
          </div>
        </Section>

        {/* PAGE HEADER */}
        <Section title="Page header" cssRef="src/components/ui/PageHeader.tsx" canon>
          <div className="stack-12" style={{ width: "100%" }}>
            <PageHeader
              eyebrow="Operations"
              title="Jobs"
              accent="list."
              subtitle="Every scheduled, active and completed clean."
              count={142}
              actions={<button className="btn btn-primary btn-sm">New job</button>}
            />
            <Replaces items={["4 hand-rolled header blocks"]} />
          </div>
        </Section>

        {/* BANNERS */}
        <Section title="Banners" cssRef=".banner .banner-amber">
          <div className="banner banner-amber" style={{ width: "100%", marginBottom: 0 }}>
            <strong>Heads up.</strong>&nbsp;This is an amber banner used for warnings and notices.
          </div>
        </Section>

        {/* TIMELINE */}
        <Section title="Timeline" cssRef=".timeline .tline-item .tline-dot">
          <div className="timeline" style={{ width: "100%" }}>
            {[
              ["Booking created", "by Jane Doe", "2:01 PM"],
              ["Cleaner assigned", "Alex Morgan", "2:05 PM"],
              ["Clocked in", "Alex Morgan", "2:00 PM"],
            ].map(([text, actor, ts], i) => (
              <div className="tline-item" key={i}>
                <span className="tline-dot" />
                <div>
                  <div className="tline-text">{text} <span className="tline-actor">{actor}</span></div>
                  <div className="tline-ts">{ts}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* LOADER */}
        <Section title="CleanoLoader (droplet)" cssRef="src/components/ui/CleanoLoader.tsx" canon>
          <div className="row" style={{ gap: 16, width: "100%", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 240px", minWidth: 240, padding: 24, borderRadius: 14, border: "1px solid var(--primary-10)", display: "flex", justifyContent: "center" }}>
              <CleanoLoader size={60} />
            </div>
            <div style={{ flex: "1 1 240px", minWidth: 240, padding: 24, borderRadius: 14, background: "var(--primary-deep)", display: "flex", justifyContent: "center" }}>
              <CleanoLoader size={60} onDark />
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
