import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Droplets,
  Package,
  Sparkles,
} from "lucide-react";

/**
 * Three more of the product, for the deep-dive sections.
 *
 * Server components: static markup, no state, nothing shipped to the browser.
 * Like the showcase surfaces these are real DOM with invented data — the ~90
 * genuine screenshots in scripts/shots* were captured against the production
 * database and carry real customers' names and real money, so none of them can
 * appear on a public page.
 *
 * Every figure below is made up, and every one of them is plausible rather than
 * flattering. A landing page whose sample dashboard shows numbers no real
 * cleaning company could hit is a landing page nobody in the trade believes.
 */

/* ── Reports ──────────────────────────────────────────────────────────────── */

const KPIS = [
  { label: "Revenue", value: "$87,235", delta: "+12.4%", up: true, good: true },
  { label: "Jobs completed", value: "225", delta: "+18", up: true, good: true },
  { label: "Repeat rate", value: "68%", delta: "+4.1%", up: true, good: true },
  // Down, and good. The direction and the verdict are separate facts.
  { label: "Labour cost", value: "39.7%", delta: "2.3%", up: false, good: true },
];

/** Five weeks of revenue, as a share of the tallest. */
const BARS = [62, 74, 58, 88, 96];

const MIX = [
  { label: "Standard", pct: 42, tone: "teal" },
  { label: "Deep clean", pct: 27, tone: "violet" },
  { label: "Move-out", pct: 18, tone: "amber" },
  { label: "Office", pct: 13, tone: "sky" },
];

export function ReportsSurface() {
  return (
    <div className="mk-app mk-app-flat" aria-hidden="true">
      <div className="mk-app-bar">
        <span className="mk-lights">
          <i /><i /><i />
        </span>
        <span className="mk-app-url">
          <b>yourcompany</b>.useawer.com<span className="mk-url-path">/reports</span>
        </span>
      </div>

      <div className="mk-rep">
        <div className="mk-app-head">
          <div>
            <strong>Reports</strong>
            <span>August, month to date</span>
          </div>
          <span className="mk-rep-range">Last 5 weeks</span>
        </div>

        <ul className="mk-kpis">
          {KPIS.map((k) => (
            <li key={k.label}>
              <span>{k.label}</span>
              <b>{k.value}</b>
              <em className={k.good ? "mk-up" : "mk-down"}>
                {k.up ? (
                  <ArrowUpRight size={12} strokeWidth={2.6} />
                ) : (
                  <ArrowDownRight size={12} strokeWidth={2.6} />
                )}
                {k.delta}
              </em>
            </li>
          ))}
        </ul>

        <div className="mk-rep-grid">
          <div className="mk-rep-card">
            <p className="mk-rep-label">Revenue by week</p>
            <div className="mk-bars">
              {BARS.map((h, i) => (
                <span key={i} style={{ height: `${h}%`, animationDelay: `${i * 70}ms` }} />
              ))}
            </div>
            <div className="mk-bars-axis">
              {["W28", "W29", "W30", "W31", "W32"].map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
          </div>

          <div className="mk-rep-card">
            <p className="mk-rep-label">Jobs by type</p>
            <ul className="mk-mix">
              {MIX.map((m) => (
                <li key={m.label} className={`mk-tone-${m.tone}`}>
                  <span>{m.label}</span>
                  <i><em style={{ width: `${m.pct}%` }} /></i>
                  <b>{m.pct}%</b>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Payroll ──────────────────────────────────────────────────────────────── */

const CREW = [
  { name: "Maria Alvarez", initials: "MA", hours: "62.5", jobs: 18, total: "$1,438.75", tone: "violet" },
  { name: "Jo Okafor", initials: "JO", hours: "58.0", jobs: 16, total: "$1,334.00", tone: "teal" },
  { name: "Sam Reyes", initials: "SR", hours: "44.5", jobs: 12, total: "$979.00", tone: "amber" },
  { name: "Priya Nair", initials: "PN", hours: "39.0", jobs: 11, total: "$897.00", tone: "sky" },
];

export function PayrollSurface() {
  return (
    <div className="mk-app mk-app-flat" aria-hidden="true">
      <div className="mk-app-bar">
        <span className="mk-lights">
          <i /><i /><i />
        </span>
        <span className="mk-app-url">
          <b>yourcompany</b>.useawer.com<span className="mk-url-path">/payroll</span>
        </span>
      </div>

      <div className="mk-pay">
        <div className="mk-app-head">
          <div>
            <strong>Pay period</strong>
            <span>1 – 15 August</span>
          </div>
          <span className="mk-pay-state">
            <Check size={13} strokeWidth={3} />
            Hours closed
          </span>
        </div>

        <div className="mk-pay-head">
          <span>Cleaner</span>
          <span>Hours</span>
          <span>Jobs</span>
          <span>Pay</span>
        </div>
        <ul className="mk-pay-rows">
          {CREW.map((c, i) => (
            <li key={c.name} style={{ animationDelay: `${i * 60}ms` }}>
              <span className="mk-pay-who">
                <i className={`mk-tone-${c.tone}`}>{c.initials}</i>
                {c.name}
              </span>
              <span className="mk-num">{c.hours}</span>
              <span className="mk-num">{c.jobs}</span>
              <b className="mk-num">{c.total}</b>
            </li>
          ))}
        </ul>

        <div className="mk-pay-foot">
          <span>
            <b>$4,648.75</b> across 4 cleaners
          </span>
          <span className="mk-pay-note">Every hour traced back to a job</span>
        </div>
      </div>
    </div>
  );
}

/* ── Inventory ────────────────────────────────────────────────────────────── */

const STOCK = [
  { item: "All-purpose spray", have: 24, of: 30, state: "ok" as const, note: "In stock" },
  { item: "Microfibre cloths", have: 8, of: 40, state: "low" as const, note: "Running low" },
  { item: "Floor solution", have: 2, of: 20, state: "out" as const, note: "Reorder" },
  { item: "Glass cleaner", have: 31, of: 36, state: "ok" as const, note: "In stock" },
];

export function InventorySurface() {
  return (
    <div className="mk-app mk-app-flat" aria-hidden="true">
      <div className="mk-app-bar">
        <span className="mk-lights">
          <i /><i /><i />
        </span>
        <span className="mk-app-url">
          <b>yourcompany</b>.useawer.com<span className="mk-url-path">/inventory</span>
        </span>
      </div>

      <div className="mk-inv">
        <div className="mk-app-head">
          <div>
            <strong>Supplies</strong>
            <span>Warehouse and caddies</span>
          </div>
          <span className="mk-inv-alert">
            <AlertTriangle size={13} strokeWidth={2.4} />2 need attention
          </span>
        </div>

        <ul className="mk-stock">
          {STOCK.map((s, i) => (
            <li key={s.item} className={`mk-st-${s.state}`} style={{ animationDelay: `${i * 60}ms` }}>
              <span className="mk-st-icon">
                <Package size={15} strokeWidth={2.1} />
              </span>
              <span className="mk-st-body">
                <b>{s.item}</b>
                <i>
                  <em style={{ width: `${Math.round((s.have / s.of) * 100)}%` }} />
                </i>
              </span>
              <span className="mk-st-count">
                <b className="mk-num">{s.have}</b>
                <em>{s.note}</em>
              </span>
            </li>
          ))}
        </ul>

        <div className="mk-wash">
          <p className="mk-rep-label">
            <Droplets size={13} strokeWidth={2.2} />
            Rag wash cycle
          </p>
          <div className="mk-wash-row">
            {[
              { n: 46, l: "Out with crews", tone: "teal" },
              { n: 18, l: "In the wash", tone: "amber" },
              { n: 12, l: "Clean and ready", tone: "green" },
            ].map((w) => (
              <span key={w.l} className={`mk-tone-${w.tone}`}>
                <b className="mk-num">{w.n}</b>
                <em>{w.l}</em>
              </span>
            ))}
          </div>
        </div>

        <p className="mk-inv-foot">
          <Sparkles size={13} strokeWidth={2.2} />
          Reorder levels are yours to set. Awer just tells you before you run out.
        </p>
      </div>
    </div>
  );
}
