"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Loader,
  MinusCircle,
  Circle,
  Pencil,
  X,
} from "lucide-react";
import type { JobChecklistItemDTO } from "@/app/admin/actions/getJobChecklist.types";
import { updateChecklistItem } from "@/app/admin/actions/updateChecklistItem";
import {
  CHECKLIST_NONE_CONFIGURED,
  CHECKLIST_STALE_HINT,
} from "@/lib/job-checklist";
import type { ChecklistItemStatus } from "@prisma/client";

interface JobChecklistPanelProps {
  /**
   * The items, already generated server-side (item 12.a/12.b). The panel used
   * to fetch these itself on mount AND offer a "Generate Checklist" button, so
   * a cleaner opening a job saw an empty box, then a spinner, then a button
   * they had to press. Both are gone: the page ensures the checklist during
   * render and hands it straight down.
   */
  items: JobChecklistItemDTO[];
  /** Allow toggling items. Disabled for paid/archived jobs. */
  canEdit: boolean;
  /** Job details changed after the checklist was created (item 12.d). */
  stale?: boolean;
}

export default function JobChecklistPanel({
  items,
  canEdit,
  stale = false,
}: JobChecklistPanelProps) {
  const router = useRouter();
  // Local copy so a tick shows instantly; re-seeded whenever the server sends
  // a new set (e.g. after a regeneration or a router.refresh()).
  const [rows, setRows] = useState<JobChecklistItemDTO[]>(items);
  const [error, setError] = useState<string | null>(null);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [editingNotesItemId, setEditingNotesItemId] = useState<string | null>(
    null
  );
  const [noteDraft, setNoteDraft] = useState("");

  useEffect(() => {
    setRows(items);
  }, [items]);

  async function handleToggle(itemId: string, nextStatus: ChecklistItemStatus) {
    if (!canEdit || pendingItemId) return;
    setPendingItemId(itemId);
    setRows((prev) =>
      prev.map((it) =>
        it.id === itemId
          ? {
              ...it,
              status: nextStatus,
              completedAt: nextStatus === "COMPLETED" ? new Date() : null,
            }
          : it
      )
    );
    const res = await updateChecklistItem({ itemId, status: nextStatus });
    if (!res.success) {
      setError(res.error);
      // The optimistic flip was wrong — pull the truth back from the server.
      router.refresh();
    }
    setPendingItemId(null);
  }

  function startEditNotes(itemId: string, current: string | null) {
    setEditingNotesItemId(itemId);
    setNoteDraft(current ?? "");
  }

  async function saveNotes(itemId: string) {
    setPendingItemId(itemId);
    const res = await updateChecklistItem({ itemId, notes: noteDraft });
    if (res.success) {
      setRows((prev) =>
        prev.map((it) =>
          it.id === itemId
            ? { ...it, notes: noteDraft.trim() ? noteDraft.trim() : null }
            : it
        )
      );
      setEditingNotesItemId(null);
    } else {
      setError(res.error);
    }
    setPendingItemId(null);
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-neutral-950/60">{CHECKLIST_NONE_CONFIGURED}</p>
    );
  }

  const total = rows.length;
  const completed = rows.filter((it) => it.status === "COMPLETED").length;
  const skipped = rows.filter((it) => it.status === "SKIPPED").length;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-700">
          {error}
        </div>
      )}

      {stale && (
        <div className="flex items-start gap-2 p-3 rounded-xl text-sm bg-amber-50 border border-amber-200 text-amber-800">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{CHECKLIST_STALE_HINT}</span>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-neutral-950/70">
          <span>
            {completed} of {total} complete
            {skipped > 0 && ` · ${skipped} skipped`}
          </span>
          <span className="font-[400]">{pct}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-neutral-950/10 overflow-hidden">
          <div
            className="h-full bg-[#008C9C] transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ul className="space-y-2">
        {rows.map((item) => {
          const isCompleted = item.status === "COMPLETED";
          const isSkipped = item.status === "SKIPPED";
          const isPending = pendingItemId === item.id;
          const isEditingNotes = editingNotesItemId === item.id;

          return (
            <li
              key={item.id}
              className={`p-3 rounded-xl border transition-colors ${
                isCompleted
                  ? "bg-[#008C9C]/5 border-[#008C9C]/15"
                  : isSkipped
                  ? "bg-neutral-100 border-neutral-200 opacity-60"
                  : "bg-white border-neutral-200"
              }`}>
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() =>
                    handleToggle(item.id, isCompleted ? "PENDING" : "COMPLETED")
                  }
                  disabled={!canEdit || isPending}
                  className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center border transition-colors disabled:opacity-50 ${
                    isCompleted
                      ? "bg-[#008C9C] border-[#008C9C] text-white"
                      : "border-neutral-300 text-transparent hover:border-[#008C9C]/50"
                  }`}
                  aria-label={
                    isCompleted ? "Mark as pending" : "Mark as completed"
                  }>
                  {isPending ? (
                    <Loader className="w-3.5 h-3.5 animate-spin text-neutral-500" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p
                        className={`text-sm font-[400] ${
                          isCompleted
                            ? "line-through text-neutral-950/60"
                            : "text-neutral-950"
                        }`}>
                        {item.title}
                        {item.isRequired && (
                          <span className="ml-1.5 text-[10px] text-red-600 align-top">
                            *
                          </span>
                        )}
                      </p>
                      {item.description && (
                        <p className="text-xs text-neutral-950/60 mt-0.5">
                          {item.description}
                        </p>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            handleToggle(item.id, isSkipped ? "PENDING" : "SKIPPED")
                          }
                          disabled={isPending || item.isRequired}
                          title={
                            item.isRequired
                              ? "Required items cannot be skipped"
                              : isSkipped
                              ? "Unskip"
                              : "Skip"
                          }
                          className="p-1 rounded-lg text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 disabled:opacity-30 disabled:cursor-not-allowed">
                          {isSkipped ? (
                            <Circle className="w-4 h-4" />
                          ) : (
                            <MinusCircle className="w-4 h-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            isEditingNotes
                              ? setEditingNotesItemId(null)
                              : startEditNotes(item.id, item.notes)
                          }
                          className="p-1 rounded-lg text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100">
                          {isEditingNotes ? (
                            <X className="w-4 h-4" />
                          ) : (
                            <Pencil className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {isEditingNotes ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        rows={2}
                        placeholder="Add a note..."
                        className="w-full px-3 py-2 rounded-lg border border-neutral-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#008C9C]/20"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingNotesItemId(null)}
                          className="px-3 py-1 rounded-lg text-xs text-neutral-700 hover:bg-neutral-100">
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => saveNotes(item.id)}
                          disabled={isPending}
                          className="px-3 py-1 rounded-lg text-xs bg-[#008C9C] text-white hover:bg-[#008C9C]/90 disabled:opacity-50">
                          Save Note
                        </button>
                      </div>
                    </div>
                  ) : (
                    item.notes && (
                      <p className="mt-2 text-xs text-neutral-950/70 italic bg-neutral-50 px-2 py-1 rounded">
                        {item.notes}
                      </p>
                    )
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
