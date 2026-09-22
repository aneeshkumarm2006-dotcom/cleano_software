"use client";

// A cleaner's rating history, and the controls to correct it.
//
// Sept 17 list, item 13. The profile used to show a number, a box to type a
// new number into, and a short list of stars. That answered "what is her
// score" and nothing else: not where a rating came from, not who moved it, not
// why. So a score that looked wrong could only be argued about.
//
// This is its own component rather than more markup inside EmployeeDetailView
// because it owns four actions and their per-row state, and that file is
// already over a thousand lines.

import { useState, useTransition } from "react";
import Link from "next/link";
import { Star } from "lucide-react";

import { addAdminRating, editRating } from "../../actions/employeeRatings";
import { setRatingExcluded } from "../../actions/setRatingExcluded";
import {
  RATING_NOTE_MAX,
  ratingSourceLabel,
  type RatingSource,
} from "@/lib/rating-history";

export interface RatingHistoryRow {
  id: string;
  rating: number;
  notes: string | null;
  createdAt: string;
  editedAt: string | null;
  clientName: string | null;
  jobId: string | null;
  jobNumber: number | null;
  source: RatingSource;
  ratedByName: string | null;
  excludedAt: string | null;
  excludedReason: string | null;
  excludedByName: string | null;
}

interface Props {
  employeeId: string;
  rows: RatingHistoryRow[];
  /** How many ratings actually count toward the average. */
  activeCount: number;
}

const SOURCE_STYLE: Record<RatingSource, string> = {
  CUSTOMER: "bg-sky-50 text-sky-700 border-sky-200",
  ADMIN: "bg-amber-50 text-amber-700 border-amber-200",
  IMPORTED: "bg-gray-50 text-gray-500 border-gray-200",
};

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export default function RatingHistoryPanel({ employeeId, rows, activeCount }: Props) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Adding
  const [adding, setAdding] = useState(false);
  const [newRating, setNewRating] = useState("");
  const [newNote, setNewNote] = useState("");

  // Editing, one row at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRatingValue, setEditRatingValue] = useState("");
  const [editNote, setEditNote] = useState("");

  const run = (fn: () => Promise<{ success: boolean; error?: string }>, ok: string) =>
    startTransition(async () => {
      setMsg(null);
      const res = await fn();
      if (res.success) {
        setMsg({ kind: "ok", text: ok });
        setAdding(false);
        setEditingId(null);
        setNewRating("");
        setNewNote("");
      } else {
        setMsg({ kind: "err", text: res.error ?? "That didn't work." });
      }
    });

  const beginEdit = (r: RatingHistoryRow) => {
    setEditingId(r.id);
    setEditRatingValue(r.rating.toFixed(1));
    setEditNote(r.notes ?? "");
    setMsg(null);
  };

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h4 className="text-xs font-[600] text-gray-500 uppercase tracking-wide">
          Rating history
        </h4>
        <button
          type="button"
          onClick={() => {
            setAdding((a) => !a);
            setMsg(null);
          }}
          className="text-xs font-[600] text-[#008C9C] hover:underline">
          {adding ? "Cancel" : "Add rating"}
        </button>
      </div>

      {adding && (
        <div className="mb-4 p-3 rounded-lg bg-gray-50 border border-gray-200 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1.0"
              max="5.0"
              step="0.1"
              value={newRating}
              onChange={(e) => setNewRating(e.target.value)}
              placeholder="1.0 – 5.0"
              aria-label="Rating"
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
            />
            <span className="text-xs text-gray-500">stars</span>
          </div>
          {/* The note is required by the action, not just asked for here. An
              admin rating moves the cleaner's pay tier, and one with no reason
              on it is indistinguishable from a mis-tap three months later. */}
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value.slice(0, RATING_NOTE_MAX))}
            rows={2}
            placeholder="Why? This is the only record of the reason once the score moves."
            aria-label="Reason"
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">
              Only the office sees this note.
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    addAdminRating({
                      employeeId,
                      rating: newRating,
                      note: newNote,
                    }),
                  "Rating added.",
                )
              }
              className="px-3 py-1.5 text-sm bg-[#008C9C] text-white rounded-lg hover:bg-[#008C9C]/90 disabled:opacity-50">
              {pending ? "Saving…" : "Add"}
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p
          role="status"
          className={`text-xs mb-3 ${msg.kind === "ok" ? "text-green-600" : "text-red-500"}`}>
          {msg.text}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-gray-500">No ratings yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const excluded = r.excludedAt != null;
            return (
              <li
                key={r.id}
                className={`text-sm ${excluded ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-[600] text-amber-500">
                        {r.rating.toFixed(1)}
                        <Star className="inline w-3 h-3 ml-0.5 -mt-0.5 fill-amber-400 text-amber-400" />
                      </span>
                      {/* Where it came from. This is the column the PDF asks
                          for by name, and without it a four-star review and a
                          four-star correction an admin typed after a complaint
                          were the same row. */}
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border font-[600] uppercase tracking-wide ${SOURCE_STYLE[r.source]}`}>
                        {ratingSourceLabel(r.source)}
                      </span>
                      {excluded && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-red-200 bg-red-50 text-red-600 font-[600] uppercase tracking-wide">
                          Not counted
                        </span>
                      )}
                      {r.editedAt && (
                        <span
                          className="text-[11px] text-gray-500 italic"
                          title={`Edited ${new Date(r.editedAt).toLocaleString()}`}>
                          (edited)
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {shortDate(r.createdAt)}
                      {r.source === "ADMIN" && r.ratedByName
                        ? ` · by ${r.ratedByName}`
                        : ""}
                      {r.clientName ? ` · ${r.clientName}` : ""}
                      {r.jobId && r.jobNumber != null ? (
                        <>
                          {" · "}
                          <Link
                            href={`/admin/jobs/${r.jobId}`}
                            className="text-[#008C9C] hover:underline">
                            Job #{r.jobNumber}
                          </Link>
                        </>
                      ) : null}
                    </p>

                    {r.notes && (
                      <p className="text-xs text-gray-500 italic mt-0.5">
                        &quot;{r.notes}&quot;
                      </p>
                    )}
                    {excluded && (
                      <p className="text-[11px] text-red-500 mt-0.5">
                        Pulled from the average
                        {r.excludedByName ? ` by ${r.excludedByName}` : ""}
                        {r.excludedReason ? ` — ${r.excludedReason}` : ""}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => beginEdit(r)}
                      className="text-[11px] text-[#008C9C] hover:underline">
                      Edit
                    </button>
                    {/* "Delete" is an exclusion, which the PDF allows outright:
                        "removed from the average or archived in logs for
                        history". Destroying the row would take the reason with
                        it, which is the thing anyone asks for afterwards. */}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (excluded) {
                          run(
                            () => setRatingExcluded({ ratingId: r.id, excluded: false }),
                            "Rating counts again.",
                          );
                          return;
                        }
                        const reason = window.prompt(
                          "Why is this rating being pulled? It stays in the history with this reason on it.",
                        );
                        if (reason === null) return;
                        run(
                          () =>
                            setRatingExcluded({
                              ratingId: r.id,
                              excluded: true,
                              reason,
                            }),
                          "Rating pulled from the average.",
                        );
                      }}
                      className="text-[11px] text-gray-500 hover:underline disabled:opacity-50">
                      {excluded ? "Put back" : "Remove"}
                    </button>
                  </div>
                </div>

                {editingId === r.id && (
                  <div className="mt-2 p-3 rounded-lg bg-gray-50 border border-gray-200 space-y-2">
                    <input
                      type="number"
                      min="1.0"
                      max="5.0"
                      step="0.1"
                      value={editRatingValue}
                      onChange={(e) => setEditRatingValue(e.target.value)}
                      aria-label="Corrected rating"
                      className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
                    />
                    <textarea
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value.slice(0, RATING_NOTE_MAX))}
                      rows={2}
                      aria-label="Note"
                      placeholder="Note"
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#008C9C]"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(
                            () =>
                              editRating({
                                ratingId: r.id,
                                rating: editRatingValue,
                                note: editNote,
                              }),
                            "Rating corrected.",
                          )
                        }
                        className="px-3 py-1.5 text-sm bg-[#008C9C] text-white rounded-lg hover:bg-[#008C9C]/90 disabled:opacity-50">
                        {pending ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="text-xs text-gray-500 hover:underline">
                        Cancel
                      </button>
                      <span className="text-[11px] text-gray-500 ml-auto">
                        The change is stamped and logged.
                      </span>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[11px] text-gray-500 mt-3">
        {activeCount} of {rows.length} shown count toward the average and the pay
        tier.
      </p>
    </div>
  );
}
