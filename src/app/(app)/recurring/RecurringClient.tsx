"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  CalendarClock,
  Gift,
} from "lucide-react";
import { initials } from "@/lib/avatar";
import AdminModal from "@/components/ui/AdminModal";

type Status = "scheduled" | "completed";

interface Occurrence {
  id: string;
  bookingNo: number;
  date: string;
  status: Status;
  generated: boolean;
  movedFrom: string | null;
}

interface Series {
  client: string;
  address: string;
  cleaner: string;
  frequency: string;
  service: string;
  basePrice: number;
  discountPct: number;
  occurrences: Occurrence[];
}

function at(days: number, h = 9, m = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function buildSeries(): Series {
  return {
    client: "Sarah Tremblay",
    address: "4218 rue Saint-Denis, Montréal",
    cleaner: "Camille Bouchard",
    frequency: "Every 2 weeks",
    service: "Standard clean",
    basePrice: 124,
    discountPct: 10,
    occurrences: [
      { id: "OC-1", bookingNo: 1, date: at(-14, 9), status: "completed", generated: false, movedFrom: null },
      { id: "OC-2", bookingNo: 2, date: at(0, 9), status: "scheduled", generated: false, movedFrom: null },
      { id: "OC-3", bookingNo: 3, date: at(15, 13), status: "scheduled", generated: false, movedFrom: at(14, 9) },
      { id: "OC-4", bookingNo: 4, date: at(28, 9), status: "scheduled", generated: true, movedFrom: null },
      { id: "OC-5", bookingNo: 5, date: at(42, 9), status: "scheduled", generated: true, movedFrom: null },
      { id: "OC-6", bookingNo: 6, date: at(56, 9), status: "scheduled", generated: true, movedFrom: null },
    ],
  };
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const fmtDateFull = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const inputDate = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const inputTime = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function Avatar({ name, size }: { name: string; size: number }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.34, border: 0, background: "var(--primary)" }}>
      {initials(name)}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function RescheduleModal({
  occ,
  onClose,
  onApply,
}: {
  occ: Occurrence;
  onClose: () => void;
  onApply: (scope: "this" | "series", newIso: string) => void;
}) {
  const [scope, setScope] = useState<"this" | "series">("this");
  const [date, setDate] = useState(inputDate(occ.date));
  const [time, setTime] = useState(inputTime(occ.date));

  function apply() {
    const [hh, mm] = time.split(":").map(Number);
    const d = new Date(date + "T00:00:00");
    d.setHours(hh, mm, 0, 0);
    onApply(scope, d.toISOString());
    onClose();
  }

  return (
    <AdminModal
      open
      title="Reschedule visit"
      subtitle={`${fmtDateFull(occ.date)} · ${fmtTime(occ.date)}`}
      onClose={onClose}
      width={500}
      footer={
        <>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm" onClick={apply}>
            Confirm reschedule
          </button>
        </>
      }>
      <div className="label" style={{ marginBottom: 8 }}>
        What should change?
      </div>
      <div className="rr-scope">
        <button
          className={`rr-scope-opt ${scope === "this" ? "on" : ""}`}
          onClick={() => setScope("this")}>
          <span className="rr-radio" />
          <span>
            <span className="rr-scope-title">This occurrence only</span>
            <span className="rr-scope-sub">
              Just {fmtDate(occ.date)} moves. The rest of the series keeps its cadence.
            </span>
          </span>
        </button>
        <button
          className={`rr-scope-opt ${scope === "series" ? "on" : ""}`}
          onClick={() => setScope("series")}>
          <span className="rr-radio" />
          <span>
            <span className="rr-scope-title">This and all future occurrences</span>
            <span className="rr-scope-sub">
              Shifts every upcoming visit to the new weekday &amp; time.
            </span>
          </span>
        </button>
      </div>

      <div className="ed-grid" style={{ marginTop: 18 }}>
        <Field label="New date">
          <input
            className="input aselect"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="New time">
          <input
            className="input aselect"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </Field>
      </div>

      <div className={`rr-impact ${scope === "series" ? "series" : ""}`}>
        <AlertCircle size={15} />
        {scope === "this"
          ? "Only this visit is affected. It will be flagged as moved from its original recurring date."
          : "All future visits shift to match. Past and completed visits are untouched."}
      </div>
    </AdminModal>
  );
}

export default function RecurringClient() {
  const router = useRouter();
  const [series] = useState<Series>(buildSeries);
  const [occs, setOccs] = useState<Occurrence[]>(series.occurrences);
  const [editing, setEditing] = useState<Occurrence | null>(null);

  function applyReschedule(scope: "this" | "series", newIso: string) {
    const target = editing;
    if (!target) return;
    setOccs((prev) => {
      const idx = prev.findIndex((o) => o.id === target.id);
      if (scope === "this") {
        return prev.map((o) =>
          o.id === target.id ? { ...o, date: newIso, movedFrom: o.movedFrom || target.date } : o
        );
      }
      const delta = new Date(newIso).getTime() - new Date(target.date).getTime();
      return prev.map((o, i) => {
        if (i < idx) return o;
        if (i === idx) return { ...o, date: newIso, movedFrom: o.movedFrom || target.date };
        const shifted = new Date(new Date(o.date).getTime() + delta).toISOString();
        return { ...o, date: shifted };
      });
    });
  }

  const perVisit = series.basePrice;
  const discounted = +(series.basePrice * (1 - series.discountPct / 100)).toFixed(2);

  return (
    <div className="admin-font">
      <button className="jdetail-back" onClick={() => router.push("/contacts")}>
        <ArrowLeft size={14} /> Back
      </button>

      <header
        className="row-between"
        style={{ marginBottom: 24, alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="stack-8">
          <p className="eyebrow">Recurring series</p>
          <h1 className="display" style={{ fontSize: "clamp(30px, 3.6vw, 42px)" }}>
            {series.service}
          </h1>
        </div>
        <span
          className="pill"
          style={{ background: "var(--primary-5)", color: "var(--primary)", fontSize: 13, padding: "7px 14px" }}>
          <CalendarClock size={13} /> {series.frequency}
        </span>
      </header>

      {/* Series summary */}
      <div
        className="dcard"
        style={{ marginBottom: 22, flexDirection: "row", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <Avatar name={series.client} size={46} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink)" }}>{series.client}</div>
          <div style={{ fontSize: 13, color: "var(--primary-60)" }}>{series.address}</div>
        </div>
        <div className="rr-summary-meta">
          <div>
            <span>Cleaner</span>
            <strong>{series.cleaner}</strong>
          </div>
          <div>
            <span>Cadence</span>
            <strong>{series.frequency}</strong>
          </div>
          <div>
            <span>Per visit</span>
            <strong>${discounted.toFixed(2)}</strong>
          </div>
        </div>
      </div>

      <div className="td-grid" style={{ gridTemplateColumns: "1.6fr 1fr" }}>
        {/* Occurrence list */}
        <div>
          <div className="td-seclabel">Upcoming visits</div>
          <div className="rr-list">
            {occs.map((o) => (
              <div
                className={`rr-occ ${o.status === "completed" ? "done" : ""} ${o.generated ? "generated" : ""}`}
                key={o.id}>
                <div className="rr-occ-date">
                  <div className="rr-occ-d">{fmtDate(o.date)}</div>
                  <div className="rr-occ-t">{fmtTime(o.date)}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>
                      Visit #{o.bookingNo}
                    </span>
                    {o.status === "completed" ? (
                      <span className="pill" style={{ background: "rgba(5,150,105,0.10)", color: "#065f46" }}>
                        Completed
                      </span>
                    ) : null}
                    {o.movedFrom ? (
                      <span className="rr-moved" title={`Moved from ${fmtDateFull(o.movedFrom)}`}>
                        <ArrowRight size={11} /> Moved
                      </span>
                    ) : null}
                    {o.generated ? (
                      <span className="rr-gen" title="Auto-generated 4 weeks ahead by the scheduler">
                        Auto-generated
                      </span>
                    ) : null}
                    {o.bookingNo === 1 ? (
                      <span className="rr-firstclean">First clean · full price</span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--primary-60)", marginTop: 3 }}>
                    {series.cleaner} ·{" "}
                    {o.bookingNo === 1 ? (
                      `$${perVisit.toFixed(2)}`
                    ) : (
                      <span>
                        ${discounted.toFixed(2)}{" "}
                        <span style={{ color: "var(--emerald-600)" }}>(−{series.discountPct}%)</span>
                      </span>
                    )}
                  </div>
                </div>
                {o.status !== "completed" ? (
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditing(o)}>
                    Reschedule
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <p className="rr-foot-note">
            <AlertCircle size={13} /> Visits are auto-generated 4 weeks ahead. New occurrences appear
            here as the series rolls forward.
          </p>
        </div>

        {/* Price breakdown */}
        <div>
          <div className="td-seclabel">Price breakdown</div>
          <div className="dcard" style={{ gap: 0 }}>
            <div className="finrow">
              <span className="finrow-label">First clean (visit #1)</span>
              <span className="finrow-value">${perVisit.toFixed(2)}</span>
            </div>
            <div className="finrow">
              <span className="finrow-label">Per recurring visit</span>
              <span className="finrow-value">${perVisit.toFixed(2)}</span>
            </div>
            <div className="finrow rr-discount-line">
              <span className="finrow-label">
                <Gift size={13} style={{ marginRight: 6, verticalAlign: "-2px" }} />
                Recurring discount{" "}
                <span style={{ color: "var(--primary-50)", fontWeight: 400 }}>· from booking #2</span>
              </span>
              <span className="finrow-value" style={{ color: "var(--emerald-600)" }}>
                −{series.discountPct}%
              </span>
            </div>
            <div className="finrow">
              <span className="finrow-label">Discounted per visit</span>
              <span className="finrow-value">${discounted.toFixed(2)}</span>
            </div>
            <div className="finrow total">
              <span className="finrow-label">Next charge</span>
              <span className="finrow-value">${discounted.toFixed(2)}</span>
            </div>
          </div>
          <div className="rr-note">
            <strong>Why the discount starts at #2:</strong> the first clean is billed at full price;
            the recurring loyalty discount applies automatically from the second visit onward.
          </div>
        </div>
      </div>

      {editing ? (
        <RescheduleModal
          occ={editing}
          onClose={() => setEditing(null)}
          onApply={applyReschedule}
        />
      ) : null}
    </div>
  );
}
