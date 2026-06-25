"use client";

import React from "react";
import { Droplets, Users, ChevronRight } from "lucide-react";

interface EmployeeRagWashData {
  id: string;
  name: string;
  email: string;
  role: string;
  totalWashes: number;
  totalRags: number;
  lastWashDate: string | null;
  lastWashRagCount: number;
}

const AVATAR_COLORS = ["#008C9C", "#0284c7", "#7c3aed", "#dc2626", "#d97706", "#059669", "#0891b2", "#be185d"];
function avatarColor(name: string) { return AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]; }
function initials(name: string) { return name.split(" ").slice(0, 2).map(p => p[0] ?? "").join("").toUpperCase(); }

export default function RagWashClient({ employees }: { employees: EmployeeRagWashData[] }) {
  const totalWashes = employees.reduce((s, e) => s + e.totalWashes, 0);
  const totalRags = employees.reduce((s, e) => s + e.totalRags, 0);
  const activeWashers = employees.filter(e => e.totalWashes > 0).length;

  return (
    <div className="admin-font stack-24">
      <header className="stack-8">
        <p className="eyebrow">Inventory & Supplies</p>
        <h1 className="display">Rag Wash</h1>
      </header>

      <div className="astat-grid">
        <div className="astat">
          <div className="astat-head"><span>Total washes</span><span className="astat-icon"><Droplets size={15} /></span></div>
          <div className="astat-value">{totalWashes}</div>
          <div className="astat-delta">all time</div>
        </div>
        <div className="astat">
          <div className="astat-head"><span>Total rags washed</span><span className="astat-icon"><Droplets size={15} /></span></div>
          <div className="astat-value">{totalRags}</div>
        </div>
        <div className="astat">
          <div className="astat-head"><span>Active washers</span><span className="astat-icon"><Users size={15} /></span></div>
          <div className="astat-value">{activeWashers}</div>
          <div className="astat-delta">of {employees.length} cleaners</div>
        </div>
      </div>

      {employees.length === 0 ? (
        <div className="atable-wrap" style={{ padding: "80px 40px", textAlign: "center", color: "var(--primary-60)" }}>
          No cleaner data yet.
        </div>
      ) : (
        <div className="atable-wrap">
          <div id="rw-desktop">
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th>Cleaner</th>
                    <th className="num">Washes</th>
                    <th className="num">Rags</th>
                    <th>Last wash</th>
                    <th className="col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {employees.map(e => (
                    <tr key={e.id} onClick={() => { window.location.href = `/admin/inventory/rag-wash/${e.id}`; }}>
                      <td style={{ minWidth: 200 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span className="avatar" style={{ background: avatarColor(e.name), fontSize: 12, width: 36, height: 36 }}>
                            {initials(e.name)}
                          </span>
                          <div>
                            <div className="col-client">{e.name}</div>
                            <div className="col-client-sub">{e.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num">
                        <span style={{ fontWeight: 600, color: "var(--ink)" }}>{e.totalWashes}</span>
                      </td>
                      <td className="num">
                        <span style={{ fontWeight: 600, color: "var(--ink)" }}>{e.totalRags}</span>
                      </td>
                      <td>
                        {e.lastWashDate ? (
                          <div>
                            <span style={{ fontSize: 12, color: "var(--primary-70)" }}>
                              {new Date(e.lastWashDate).toLocaleDateString("en-US")}
                            </span>
                            <div className="col-client-sub">{e.lastWashRagCount} rags</div>
                          </div>
                        ) : (
                          <span style={{ color: "var(--primary-40)", fontSize: 12 }}>No washes</span>
                        )}
                      </td>
                      <td className="col-actions" onClick={ev => ev.stopPropagation()}>
                        <a href={`/admin/inventory/rag-wash/${e.id}`} className="btn btn-secondary btn-sm" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          View <ChevronRight size={12} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div id="rw-mobile" style={{ display: "none", flexDirection: "column", gap: 10, padding: 16 }}>
            {employees.map(e => (
              <article key={e.id} className="jcard" style={{ cursor: "pointer" }} onClick={() => { window.location.href = `/admin/inventory/rag-wash/${e.id}`; }}>
                <div className="jcard-top">
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span className="avatar" style={{ background: avatarColor(e.name), fontSize: 12, width: 36, height: 36 }}>
                      {initials(e.name)}
                    </span>
                    <div>
                      <div className="jcard-client">{e.name}</div>
                      <div className="jcard-meta">{e.email}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="jcard-price">{e.totalWashes} washes</div>
                    <div className="jcard-meta">{e.totalRags} rags</div>
                  </div>
                </div>
                {e.lastWashDate && (
                  <div className="jcard-meta" style={{ marginTop: 8 }}>
                    Last wash: {new Date(e.lastWashDate).toLocaleDateString("en-US")} · {e.lastWashRagCount} rags
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          #rw-desktop { display: none !important; }
          #rw-mobile  { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
