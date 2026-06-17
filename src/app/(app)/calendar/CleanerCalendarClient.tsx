"use client";

// Cleaner calendar — premium read-only schedule (Month / Week / Day / Agenda).
// Ported from the Cleano "Cleaner Calendar" design handoff. Read-only: no
// create / drag / reschedule / resize / overlays — clicking a job opens a
// details drawer with a "contact dispatch to make changes" notice.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  X,
  MapPin,
  CalendarClock,
  Sparkles,
  CreditCard,
  Briefcase,
  Eye,
} from "lucide-react";
import { avatarColor, initials } from "@/lib/avatar";

interface CalJob {
  id: string;
  jobNumber: number;
  clientName: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  jobType: string | null;
  location: string | null;
  employeePay: number | null;
  notes: string | null;
  cleaners: string[];
}

type StatusMeta = { label: string; color: string; tint: string };
const STATUS: Record<string, StatusMeta> = {
  CREATED: { label: "Created", color: "#64748b", tint: "rgba(100,116,139,0.10)" },
  SCHEDULED: { label: "Scheduled", color: "#008C9C", tint: "rgba(0,140,156,0.09)" },
  IN_PROGRESS: { label: "In progress", color: "#d97706", tint: "rgba(217,119,6,0.11)" },
  COMPLETED: { label: "Completed", color: "#059669", tint: "rgba(5,150,105,0.11)" },
  PAID: { label: "Paid", color: "#15803d", tint: "rgba(21,128,61,0.11)" },
  CANCELLED: { label: "Cancelled", color: "#dc2626", tint: "rgba(220,38,38,0.08)" },
};
const meta = (s: string): StatusMeta => STATUS[s] ?? STATUS.SCHEDULED;
const unconfirmed = (j: CalJob) => j.status === "CREATED";

const START_HOUR = 6;
const END_HOUR = 22;
const OFFICE_START = 8 * 60;
const OFFICE_END = 18 * 60;
const PX_PER_HOUR = 64;

// ── date helpers ──
const jobStart = (j: CalJob) => new Date(j.startTime ?? j.date);
const jobDurMin = (j: CalJob) => {
  if (j.startTime && j.endTime) {
    const d = (new Date(j.endTime).getTime() - new Date(j.startTime).getTime()) / 60000;
    if (d > 0) return Math.max(30, d);
  }
  return 120;
};
const minOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
function startOfWeek(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
const fmtTime = (d: Date) =>
  d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "");
function fmtHour(h: number) {
  const ap = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ap}`;
}
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const typeLabel = (t: string | null) =>
  t ? t.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : "Clean";

type ViewKind = "month" | "week" | "day" | "agenda";

// ── overlap layout for time grid ──
function layout(dayJobs: CalJob[]) {
  const sorted = [...dayJobs].sort((a, b) => +jobStart(a) - +jobStart(b));
  const out: { job: CalJob; col: number; cols: number }[] = [];
  const active: { end: number; col: number }[] = [];
  let clusterCols = 1;
  let cluster: { job: CalJob; col: number; cols: number }[] = [];
  const flush = () => {
    cluster.forEach((o) => (o.cols = clusterCols));
    cluster = [];
    clusterCols = 1;
  };
  sorted.forEach((job) => {
    const s = +jobStart(job);
    const e = s + jobDurMin(job) * 60000;
    for (let i = active.length - 1; i >= 0; i--) if (active[i].end <= s) active.splice(i, 1);
    if (active.length === 0) flush();
    let col = 0;
    const used = new Set(active.map((a) => a.col));
    while (used.has(col)) col++;
    active.push({ end: e, col });
    clusterCols = Math.max(clusterCols, active.length);
    const rec = { job, col, cols: 1 };
    out.push(rec);
    cluster.push(rec);
  });
  flush();
  return out;
}

function StatusPill({ s }: { s: string }) {
  const m = meta(s);
  return (
    <span className="pill" style={{ background: m.tint, color: m.color }}>
      <span className="pill-dot" style={{ background: m.color }} />
      {m.label}
    </span>
  );
}

// ── Month ──
function MonthView({ anchor, jobs, onDay, onJob }: { anchor: Date; jobs: CalJob[]; onDay: (d: Date) => void; onJob: (j: CalJob) => void }) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = new Date();
  return (
    <div className="cal-month">
      <div className="cal-month-dow">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d}>{d}</div>)}</div>
      <div className="cal-month-grid">
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const isToday = sameDay(d, today);
          const list = jobs.filter((j) => sameDay(jobStart(j), d)).sort((a, b) => +jobStart(a) - +jobStart(b));
          return (
            <div key={i} className={`cal-mcell ${inMonth ? "" : "out"} ${isToday ? "today" : ""}`} onClick={() => onDay(d)}>
              <div className="cal-mcell-head">
                {list.length ? <span className="cal-mcount">{list.length} {list.length === 1 ? "job" : "jobs"}</span> : <span />}
                <span className={`cal-mdate ${isToday ? "today" : ""}`}>{d.getDate()}</span>
              </div>
              <div className="cal-mcell-jobs">
                {list.slice(0, 2).map((j) => {
                  const m = meta(j.status);
                  return (
                    <button key={j.id} className={`cal-chip ${unconfirmed(j) ? "faded" : ""}`} style={{ background: m.tint, color: m.color }} onClick={(e) => { e.stopPropagation(); onJob(j); }}>
                      <span className="cal-chip-dot" style={{ background: m.color }} />
                      <span className="cal-chip-t">{fmtTime(jobStart(j))}</span>
                      <span className="cal-chip-n">{j.clientName.split(" ")[0]}</span>
                    </button>
                  );
                })}
                {list.length > 2 ? <button className="cal-more" onClick={(e) => { e.stopPropagation(); onDay(d); }}>+{list.length - 2} more</button> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Agenda ──
function AgendaView({ anchor, jobs, onJob }: { anchor: Date; jobs: CalJob[]; onJob: (j: CalJob) => void }) {
  const s = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(s, i));
  return (
    <div className="cal-agenda">
      {days.map((d, i) => {
        const list = jobs.filter((j) => sameDay(jobStart(j), d)).sort((a, b) => +jobStart(a) - +jobStart(b));
        const isToday = sameDay(d, new Date());
        return (
          <div key={i} className={`cal-ag-day ${isToday ? "today" : ""}`}>
            <div className="cal-ag-date">
              <span className="cal-ag-dow">{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
              <span className="cal-ag-num">{d.getDate()}</span>
            </div>
            <div className="cal-ag-list">
              {list.length === 0 ? (
                <div className="cal-ag-empty">No jobs</div>
              ) : (
                list.map((j) => {
                  const m = meta(j.status);
                  return (
                    <button key={j.id} className="cal-ag-row" style={{ borderLeftColor: m.color }} onClick={() => onJob(j)}>
                      <span className="cal-ag-time">{fmtTime(jobStart(j))}</span>
                      <span className="cal-ag-main">
                        <strong>{j.clientName}</strong>
                        <span>{typeLabel(j.jobType)}{j.employeePay != null ? ` · ${money(j.employeePay)}` : ""}</span>
                      </span>
                      <StatusPill s={j.status} />
                    </button>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Time grid (week/day, read-only) ──
function TimeGrid({ view, anchor, jobs, onJob }: { view: "week" | "day"; anchor: Date; jobs: CalJob[]; onJob: (j: CalJob) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowMin, setNowMin] = useState(minOfDay(new Date()));
  const days = view === "day" ? [new Date(anchor)] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));

  const totalMin = (END_HOUR - START_HOUR) * 60;
  const gridH = (totalMin / 60) * PX_PER_HOUR;
  const minToY = (min: number) => ((min - START_HOUR * 60) / 60) * PX_PER_HOUR;
  const hours: number[] = [];
  for (let h = START_HOUR; h <= END_HOUR; h++) hours.push(h);

  useEffect(() => {
    const t = setInterval(() => setNowMin(minOfDay(new Date())), 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = minToY(7 * 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="cal-grid" ref={scrollRef}>
      <div className="cal-grid-inner" style={{ height: gridH + 56 }}>
        <div className="cal-grid-header">
          <div className="cal-gutter-head" />
          {days.map((d, i) => {
            const isToday = sameDay(d, new Date());
            const count = jobs.filter((j) => sameDay(jobStart(j), d)).length;
            return (
              <div key={i} className={`cal-dayhead ${isToday ? "today" : ""}`}>
                <span className="cal-dayhead-dow">{d.toLocaleDateString("en-US", { weekday: view === "day" ? "long" : "short" })}</span>
                <span className={`cal-dayhead-num ${isToday ? "today" : ""}`}>{d.getDate()}</span>
                {count ? <span className="cal-dayhead-count">{count}</span> : null}
              </div>
            );
          })}
        </div>

        <div className="cal-grid-scroll">
          <div className="cal-gutter">
            {hours.map((h) => <div key={h} className="cal-hour" style={{ height: PX_PER_HOUR }}><span>{fmtHour(h)}</span></div>)}
          </div>
          <div className="cal-cols" style={{ height: gridH }}>
            <div className="cal-hourlines">
              {hours.map((h) => <div key={h} className="cal-hline" style={{ height: PX_PER_HOUR }} />)}
            </div>
            {days.map((d, i) => {
              const dayJobs = layout(jobs.filter((j) => sameDay(jobStart(j), d)));
              const isToday = sameDay(d, new Date());
              return (
                <div key={i} className="cal-col">
                  <div className="cal-office" style={{ top: minToY(OFFICE_START), height: ((OFFICE_END - OFFICE_START) / 60) * PX_PER_HOUR }} />
                  {isToday && nowMin >= START_HOUR * 60 && nowMin <= END_HOUR * 60 ? (
                    <div className="cal-now" style={{ top: minToY(nowMin) }}><span className="cal-now-dot" /></div>
                  ) : null}
                  {dayJobs.map(({ job, col, cols }) => {
                    const m = meta(job.status);
                    const sMin = Math.max(START_HOUR * 60, minOfDay(jobStart(job)));
                    const dur = jobDurMin(job);
                    const h = Math.max(22, (dur / 60) * PX_PER_HOUR - 3);
                    const compact = dur <= 60;
                    return (
                      <div
                        key={job.id}
                        className={`cal-ev ${unconfirmed(job) ? "faded" : ""} ${job.status === "CANCELLED" ? "cancelled" : ""}`}
                        style={{
                          top: minToY(sMin),
                          height: h,
                          left: `calc(${(col / cols) * 100}% + 3px)`,
                          width: `calc(${100 / cols}% - 6px)`,
                          background: m.tint,
                          borderColor: m.color,
                          ["--evc" as string]: m.color,
                        }}
                        onClick={() => onJob(job)}>
                        <span className="cal-ev-bar" style={{ background: m.color }} />
                        <div className="cal-ev-in">
                          <div className="cal-ev-top"><span className="cal-ev-client">{job.clientName}</span></div>
                          {!compact ? <div className="cal-ev-meta">{fmtTime(jobStart(job))} · {typeLabel(job.jobType)}</div> : null}
                          {!compact && (dur / 60) * PX_PER_HOUR > 70 ? (
                            <div className="cal-ev-foot">
                              <span className="cal-ev-loc">{job.location ?? ""}</span>
                              {job.employeePay != null ? <span className="cal-ev-pay">{money(job.employeePay)}</span> : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Read-only job drawer (matches the design's JobModal, read-only path) ──
function JobModal({ job, onClose }: { job: CalJob; onClose: () => void }) {
  const start = jobStart(job);
  const dur = jobDurMin(job);
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(8,20,22,0.4)", display: "flex", justifyContent: "flex-end" }}
      onClick={onClose}>
      <div
        className="admin-font"
        style={{ width: 440, maxWidth: "100%", height: "100%", background: "#fff", boxShadow: "var(--shadow-pop)", padding: "24px 26px", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18, gap: 12 }}>
          <div>
            <h2 className="title-sm">{job.clientName}</h2>
            <div className="cjm-sub">#{job.jobNumber} · {typeLabel(job.jobType)} clean</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="cjm">
          <div className="cjm-statusrow">
            <StatusPill s={job.status} />
          </div>

          <div className="cjm-rows">
            <div className="cjm-row">
              <span className="cjm-k"><CalendarClock size={15} /> When</span>
              <span className="cjm-v">
                {start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · {fmtTime(start)}{" "}
                <span style={{ color: "var(--primary-50)" }}>({Math.round((dur / 60) * 10) / 10}h)</span>
              </span>
            </div>
            {job.location ? (
              <div className="cjm-row"><span className="cjm-k"><MapPin size={15} /> Location</span><span className="cjm-v">{job.location}</span></div>
            ) : null}
            <div className="cjm-row"><span className="cjm-k"><Sparkles size={15} /> Service</span><span className="cjm-v">{typeLabel(job.jobType)}</span></div>
            {job.employeePay != null ? (
              <div className="cjm-row"><span className="cjm-k"><CreditCard size={15} /> Cleaner pay</span><span className="cjm-v">{money(job.employeePay)}</span></div>
            ) : null}
            {job.cleaners.length ? (
              <div className="cjm-row">
                <span className="cjm-k"><Briefcase size={15} /> Team</span>
                <span className="cjm-v cjm-team">
                  {job.cleaners.map((name) => (
                    <span key={name} className="cjm-av" style={{ background: avatarColor(name) }} title={name}>{initials(name)}</span>
                  ))}
                  {job.cleaners.map((n) => n.split(" ")[0]).join(", ")}
                </span>
              </div>
            ) : null}
          </div>

          {job.notes ? (
            <div className="cjm-note">
              <div className="cjm-note-label">Job note</div>
              <p>{job.notes}</p>
            </div>
          ) : null}

          <div className="cjm-ro"><Eye size={15} /> Read-only view — contact dispatch to make changes.</div>
        </div>
      </div>
    </div>
  );
}

export default function CleanerCalendarClient({ jobs }: { jobs: CalJob[] }) {
  const [view, setView] = useState<ViewKind>("week");
  const [anchor, setAnchor] = useState(new Date());
  const [modalJob, setModalJob] = useState<CalJob | null>(null);

  const VIEWS: ViewKind[] = ["month", "week", "day", "agenda"];

  function go(dir: number) {
    const d = new Date(anchor);
    if (view === "month") d.setMonth(d.getMonth() + dir);
    else if (view === "day") d.setDate(d.getDate() + dir);
    else d.setDate(d.getDate() + dir * 7);
    setAnchor(d);
  }

  const rangeLabel = useMemo(() => {
    if (view === "month") return anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (view === "day") return anchor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    const s = startOfWeek(anchor);
    const e = addDays(s, 6);
    const sM = s.toLocaleDateString("en-US", { month: "short" });
    const eM = e.toLocaleDateString("en-US", { month: "short" });
    return `${sM} ${s.getDate()} – ${sM === eM ? "" : eM + " "}${e.getDate()}, ${e.getFullYear()}`;
  }, [view, anchor]);

  return (
    <div className="admin-font cal-page">
      <div className="cal-toolbar">
        <div className="cal-tb-left">
          <div className="cal-nav">
            <button className="cal-navbtn" onClick={() => go(-1)} aria-label="Previous"><ChevronLeft size={18} /></button>
            <button className="cal-today" onClick={() => setAnchor(new Date())}>Today</button>
            <button className="cal-navbtn" onClick={() => go(1)} aria-label="Next"><ChevronRight size={18} /></button>
          </div>
          <h1 className="cal-range">{rangeLabel}</h1>
        </div>
        <div className="cal-tb-right">
          <div className="cal-viewseg">
            {VIEWS.map((v) => (
              <button key={v} className={`cal-vbtn ${view === v ? "active" : ""}`} onClick={() => setView(v)}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="cal-body">
        {view === "month" ? <MonthView anchor={anchor} jobs={jobs} onDay={(d) => { setAnchor(d); setView("day"); }} onJob={setModalJob} /> : null}
        {view === "agenda" ? <AgendaView anchor={anchor} jobs={jobs} onJob={setModalJob} /> : null}
        {view === "week" || view === "day" ? <TimeGrid view={view} anchor={anchor} jobs={jobs} onJob={setModalJob} /> : null}
      </div>

      {modalJob ? <JobModal job={modalJob} onClose={() => setModalJob(null)} /> : null}
    </div>
  );
}
