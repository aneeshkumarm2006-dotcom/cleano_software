// Canonical page header — ported from the Cleano design handoff.
// Replaces the 4 hand-rolled `.eyebrow + .display + .subtitle` blocks across
// the admin pages with one component.
//
//   <PageHeader eyebrow="Operations" title="Jobs" accent="list."
//     subtitle="Every scheduled, active and completed clean." count={142}
//     actions={<button className="btn btn-primary">New job</button>} />

import React from "react";

export interface PageHeaderProps {
  eyebrow?: string;
  title: React.ReactNode;
  /** Italic accent rendered after the title (the `<em>` in the design). */
  accent?: string;
  subtitle?: string;
  /** Optional count appended to the title as " · N". */
  count?: number;
  actions?: React.ReactNode;
}

export default function PageHeader({
  eyebrow,
  title,
  accent,
  subtitle,
  count,
  actions,
}: PageHeaderProps) {
  return (
    <header
      className="row-between"
      style={{ alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
      <div className="stack-8">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="display">
          {title}
          {accent ? (
            <>
              {" "}
              <em>{accent}</em>
            </>
          ) : null}
          {typeof count === "number" ? (
            <span style={{ color: "var(--primary-40)", fontWeight: 300 }}> · {count}</span>
          ) : null}
        </h1>
        {subtitle ? <p className="subtitle">{subtitle}</p> : null}
      </div>
      {actions ? (
        <div className="row" style={{ gap: 8 }}>
          {actions}
        </div>
      ) : null}
    </header>
  );
}
