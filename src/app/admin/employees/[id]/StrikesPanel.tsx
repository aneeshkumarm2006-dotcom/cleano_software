"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, ShieldCheck, ShieldX, Plus } from "lucide-react";
import {
  STRIKE_REASON_LABELS,
  STRIKE_THRESHOLD,
  type StrikeLevel,
} from "@/lib/strikes-constants";
import { addStrikeManual, updateStrike } from "../../actions/manageStrikes";

type StrikeReasonCode = keyof typeof STRIKE_REASON_LABELS;

interface StrikeDTO {
  id: string;
  reasonCode: StrikeReasonCode;
  reason: string;
  status: "ACTIVE" | "EXPIRED" | "EXCUSED" | "REMOVED";
  isAuto: boolean;
  adminNote: string | null;
  jobNumber: number | null;
  createdAt: string;
  expiresAt: string;
  excusedAt: string | null;
}

interface Props {
  cleanerId: string;
  strikes: StrikeDTO[];
  strikeSummary: { activeCount: number; level: StrikeLevel };
  strikeWindowDays: number;
}

const STATUS_BADGE: Record<StrikeDTO["status"], { label: string; cls: string }> = {
  ACTIVE: { label: "Active", cls: "bg-red-100 text-red-700" },
  EXPIRED: { label: "Expired", cls: "bg-gray-100 text-gray-500" },
  EXCUSED: { label: "Excused", cls: "bg-amber-100 text-amber-700" },
  REMOVED: { label: "Removed", cls: "bg-gray-100 text-gray-500" },
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function StrikesPanel({
  cleanerId,
  strikes,
  strikeSummary,
  strikeWindowDays,
}: Props) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [reasonCode, setReasonCode] = useState<StrikeReasonCode>("MANUAL");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(
    null
  );
  // Inline action note: { strikeId, action }
  const [pending, setPending] = useState<{
    strikeId: string;
    action: "remove" | "excuse" | "reactivate";
  } | null>(null);
  const [actionNote, setActionNote] = useState("");

  const { activeCount, level } = strikeSummary;

  const banner =
    level === "REVIEW"
      ? {
          icon: <ShieldX className="w-5 h-5" />,
          cls: "bg-red-50 border-red-200 text-red-800",
          title: `Flagged for review — ${activeCount} active strikes`,
          sub: `At ${STRIKE_THRESHOLD} active strikes this cleaner needs admin review.`,
        }
      : level === "WARNING"
      ? {
          icon: <ShieldAlert className="w-5 h-5" />,
          cls: "bg-amber-50 border-amber-200 text-amber-800",
          title: `Warning — ${activeCount} active strike${activeCount === 1 ? "" : "s"}`,
          sub: `${STRIKE_THRESHOLD - activeCount} more before admin review.`,
        }
      : {
          icon: <ShieldCheck className="w-5 h-5" />,
          cls: "bg-green-50 border-green-200 text-green-800",
          title: "No active strikes",
          sub: "This cleaner is in good standing.",
        };

  async function submitAdd() {
    if (!note.trim()) {
      setMsg({ type: "error", text: "A note is required." });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await addStrikeManual({ cleanerId, reasonCode, note });
    setBusy(false);
    if (res.success) {
      setNote("");
      setAdding(false);
      setReasonCode("MANUAL");
      router.refresh();
    } else {
      setMsg({ type: "error", text: res.error ?? "Failed to add strike" });
    }
  }

  async function submitAction() {
    if (!pending) return;
    if (!actionNote.trim()) {
      setMsg({ type: "error", text: "A note is required." });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await updateStrike({
      strikeId: pending.strikeId,
      action: pending.action,
      note: actionNote,
    });
    setBusy(false);
    if (res.success) {
      setPending(null);
      setActionNote("");
      router.refresh();
    } else {
      setMsg({ type: "error", text: res.error ?? "Failed to update strike" });
    }
  }

  return (
    <div className="space-y-5">
      {/* Status banner */}
      <div className={`flex items-start gap-3 p-4 rounded-xl border ${banner.cls}`}>
        <span className="mt-0.5">{banner.icon}</span>
        <div className="flex-1">
          <p className="font-[600] text-sm">{banner.title}</p>
          <p className="text-xs opacity-80 mt-0.5">{banner.sub}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-[700] leading-none">{activeCount}/{STRIKE_THRESHOLD}</div>
          <div className="text-[11px] opacity-70 mt-1">active</div>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Strikes roll off automatically {strikeWindowDays} days after they&apos;re
        applied. Excused and removed strikes stop counting immediately.
      </p>

      {msg && (
        <p className={`text-xs ${msg.type === "success" ? "text-green-600" : "text-red-500"}`}>
          {msg.text}
        </p>
      )}

      {/* Add strike */}
      {adding ? (
        <div className="border border-gray-200 rounded-xl p-4 space-y-3">
          <div>
            <label className="block text-xs font-[600] text-gray-600 mb-1">Reason</label>
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value as StrikeReasonCode)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#008C9C]">
              {(Object.keys(STRIKE_REASON_LABELS) as StrikeReasonCode[]).map((code) => (
                <option key={code} value={code}>
                  {STRIKE_REASON_LABELS[code]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-[600] text-gray-600 mb-1">
              Note <span className="text-red-500">*</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Why is this strike being added?"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={submitAdd}
              disabled={busy}
              className="px-3 py-1.5 text-sm bg-[#008C9C] text-white rounded-lg hover:bg-[#008C9C]/90 disabled:opacity-50">
              {busy ? "Saving…" : "Add strike"}
            </button>
            <button
              onClick={() => { setAdding(false); setNote(""); setMsg(null); }}
              className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
          <Plus className="w-4 h-4" /> Add strike
        </button>
      )}

      {/* Strike list */}
      <div className="space-y-2">
        {strikes.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">No strikes on record.</p>
        ) : (
          strikes.map((s) => {
            const badge = STATUS_BADGE[s.status];
            const isActive = s.status === "ACTIVE";
            return (
              <div key={s.id} className="border border-gray-200 rounded-xl p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${badge.cls}`}>
                        {badge.label}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                        {s.isAuto ? "Auto" : "Manual"}
                      </span>
                      {s.jobNumber != null && (
                        <span className="text-[11px] text-gray-400">Job #{s.jobNumber}</span>
                      )}
                    </div>
                    <p className="text-sm text-gray-800 mt-1.5">{s.reason}</p>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Applied {fmt(s.createdAt)} · {isActive ? `resets ${fmt(s.expiresAt)}` : badge.label.toLowerCase()}
                    </p>
                    {s.adminNote && (
                      <p className="text-[11px] text-gray-500 mt-1 whitespace-pre-line border-l-2 border-gray-100 pl-2">
                        {s.adminNote}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {isActive ? (
                      <>
                        <button
                          onClick={() => { setPending({ strikeId: s.id, action: "excuse" }); setActionNote(""); setMsg(null); }}
                          className="text-xs px-2 py-1 rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50">
                          Excuse
                        </button>
                        <button
                          onClick={() => { setPending({ strikeId: s.id, action: "remove" }); setActionNote(""); setMsg(null); }}
                          className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-700 hover:bg-red-50">
                          Remove
                        </button>
                      </>
                    ) : (s.status === "EXCUSED" || s.status === "REMOVED") ? (
                      <button
                        onClick={() => { setPending({ strikeId: s.id, action: "reactivate" }); setActionNote(""); setMsg(null); }}
                        className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
                        Reactivate
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Inline note for the pending action on this strike */}
                {pending?.strikeId === s.id && (
                  <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
                    <textarea
                      value={actionNote}
                      onChange={(e) => setActionNote(e.target.value)}
                      rows={2}
                      placeholder={`Reason for ${pending.action} (required)`}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={submitAction}
                        disabled={busy}
                        className="px-3 py-1.5 text-sm bg-[#008C9C] text-white rounded-lg hover:bg-[#008C9C]/90 disabled:opacity-50">
                        {busy ? "Saving…" : `Confirm ${pending.action}`}
                      </button>
                      <button
                        onClick={() => { setPending(null); setActionNote(""); }}
                        className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
