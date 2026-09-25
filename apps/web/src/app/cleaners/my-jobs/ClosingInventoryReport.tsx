"use client";

import { useMemo } from "react";
import {
  CLOSING_NOTE_MAX,
  MAX_KIT_QUANTITY,
  kindForItemType,
  type ClosingReport,
  type ClosingReportEntry,
} from "@/lib/clock-out";
import {
  COUNTABLE_STATUSES,
  COUNTABLE_STATUS_HINT,
  COUNTABLE_STATUS_LABEL,
  EQUIPMENT_CONDITIONS,
  EQUIPMENT_CONDITION_HINT,
  EQUIPMENT_CONDITION_LABEL,
  LIQUID_LEVELS,
  LIQUID_LEVEL_LABEL,
  type CountableStatus,
  type EquipmentCondition,
  type LiquidLevel,
} from "@/lib/inventory-status";
import { ITEM_TYPE_LABEL, type ItemType } from "@/lib/item-type";
import {
  ClockOutFieldNote,
  clockOutFieldStyle,
  isClockOutFieldError,
  type ClockOutErrorState,
} from "./ClockOutError";

/**
 * The closing inventory report (cleano_inventory_operations_fixes.pdf #2,
 * Stage 3 of `_ai_context/TODO.md`).
 *
 * ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
 * A "Post-job inventory" survey that asked every cleaner, on every job, to
 * estimate consumption: Light use (15 sprays) / Medium (30) / Heavy (40+),
 * converted at 1.25 ml a pull and deducted from their kit. It shipped TWICE —
 * `ClockOutButton.tsx` and `ClockPageClient.tsx` each carried their own copy of
 * SPRAY_OPTIONS, MOP_OPTIONS, DISPOSABLE_OPTIONS and their own `ML_PER_SPRAY`
 * constant, which is how the two screens came to render subtly different
 * footers for the same choice.
 *
 * ── WHAT IT IS NOW ─────────────────────────────────────────────────────────
 * ONE component, imported by both screens, asking the one question a cleaner
 * can answer accurately:
 *
 *   Step 1   "Any product levels changed?"  →  No changes | Update inventory
 *   Step 2   only for the items they choose to touch, in the vocabulary that
 *            fits the product — a level for liquids, a count (plus an optional
 *            status) for countables, a condition for tools.
 *
 * UNTOUCHED ITEMS ARE NOT SUBMITTED. `buildReport()` emits a line only for a
 * row the cleaner actually opened and answered, so an item nobody looked at is
 * absent from the payload rather than re-asserting its old value — which is
 * what makes "cleaner marks only what changed" true rather than a slogan.
 *
 * ── MOBILE INPUT RULES (Stage 6, applied from day one) ─────────────────────
 * The screenshot on p.3 of the PDF shows the failure mode: washed-out teal
 * labels, a quantity box autofilled with a faint `1`, placeholder text that
 * can't be read, and an iOS keyboard covering the buttons. So here: body text
 * is `--ink` rather than a tinted primary, every number field is a plain string
 * that CAN be cleared to empty (no phantom `1`, no `?? "0"` reading a blank box
 * as zero), inputs are 16px so iOS doesn't zoom, and the scroll container keeps
 * a keyboard-sized gap under the last control.
 */

/** One kit line, as this component needs to see it. */
export interface ClosingReportItem {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  itemType: ItemType;
  /** Latest reported values, so a row opens on what is already on record. */
  levelStatus?: LiquidLevel | null;
  condition?: EquipmentCondition | null;
}

type Draft =
  | { kind: "LEVEL"; levelStatus: LiquidLevel | null; note: string }
  | { kind: "COUNT"; quantity: string; status: CountableStatus | null; note: string }
  | { kind: "CONDITION"; condition: EquipmentCondition | null; note: string };

/** Sections in the order a cleaner works through their bag. */
const SECTIONS: Array<{ itemType: ItemType; title: string; prompt: string }> = [
  { itemType: "LIQUID", title: "Liquids", prompt: "How much is left in the bottle?" },
  {
    itemType: "COUNTABLE_CONSUMABLE",
    title: "Consumables",
    prompt: "How many do you have left?",
  },
  {
    itemType: "REUSABLE_EQUIPMENT",
    title: "Tools & equipment",
    prompt: "What state is it in?",
  },
];

/**
 * A blank row.
 *
 * Deliberately NOT pre-seeded with the item's stored level/condition. Seeding
 * would make every row look answered the moment the sheet opened, and
 * `buildReport()` would then submit the whole kit on every clock-out — which is
 * the "untouched items are re-submitted" behaviour PDF #2 asks us to stop. What
 * is already on record is shown as text beside the row instead.
 */
function emptyDraft(item: ClosingReportItem): Draft {
  switch (kindForItemType(item.itemType)) {
    case "LEVEL":
      return { kind: "LEVEL", levelStatus: null, note: "" };
    case "CONDITION":
      return { kind: "CONDITION", condition: null, note: "" };
    case "COUNT":
      return { kind: "COUNT", quantity: "", status: null, note: "" };
  }
}

/** Has this row been answered? An opened-but-blank row submits nothing. */
function isAnswered(draft: Draft): boolean {
  if (draft.kind === "LEVEL") return draft.levelStatus !== null;
  if (draft.kind === "CONDITION") return draft.condition !== null;
  return draft.quantity.trim() !== "" || draft.status !== null;
}

/**
 * The payload. Only answered rows appear — this is the function that makes
 * "untouched items are not re-submitted" a property of the code rather than a
 * promise in a comment.
 */
export function buildReport(drafts: Record<string, Draft>): ClosingReport {
  const items: ClosingReportEntry[] = [];
  for (const [productId, draft] of Object.entries(drafts)) {
    if (!isAnswered(draft)) continue;
    if (draft.kind === "LEVEL") {
      items.push({
        productId,
        kind: "LEVEL",
        levelStatus: draft.levelStatus,
        note: draft.note || null,
      });
    } else if (draft.kind === "CONDITION") {
      items.push({
        productId,
        kind: "CONDITION",
        condition: draft.condition,
        note: draft.note || null,
      });
    } else {
      const trimmed = draft.quantity.trim();
      items.push({
        productId,
        kind: "COUNT",
        // A cleared box is "I didn't count it", never zero — the distinction
        // the old `parseFloat(x ?? "0")` collapsed, which read a blank field as
        // "used their entire stock".
        quantity: trimmed === "" ? null : Number(trimmed),
        status: draft.status,
        note: draft.note || null,
      });
    }
  }
  return { items };
}

/** How many rows carry an answer — drives the submit button's label. */
export function answeredCount(drafts: Record<string, Draft>): number {
  return Object.values(drafts).filter(isAnswered).length;
}

/**
 * What we already believe about this item, in one short phrase.
 *
 * The rows start blank on purpose (see `emptyDraft`), so this is how a cleaner
 * sees what they are correcting — and, for a tool, whether the damage they are
 * about to report is already on file.
 */
function onRecord(item: ClosingReportItem): string {
  if (item.itemType === "COUNTABLE_CONSUMABLE") {
    return `${item.quantity} ${item.unit} on record`;
  }
  if (item.itemType === "LIQUID") {
    return item.levelStatus
      ? `Last reported ${LIQUID_LEVEL_LABEL[item.levelStatus].toLowerCase()}`
      : "Not reported yet";
  }
  return item.condition
    ? EQUIPMENT_CONDITION_LABEL[item.condition]
    : ITEM_TYPE_LABEL[item.itemType];
}

interface Props {
  items: ClosingReportItem[];
  /** Lifted so the host can submit it and re-send the SAME payload on Retry. */
  drafts: Record<string, Draft>;
  onChange: (next: Record<string, Draft>) => void;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  /** The failure being shown, so the named product's row can be marked. */
  failure?: ClockOutErrorState | null;
  disabled?: boolean;
}

export default function ClosingInventoryReport({
  items,
  drafts,
  onChange,
  editing,
  onEditingChange,
  failure = null,
  disabled = false,
}: Props) {
  const grouped = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        items: items.filter((i) => i.itemType === section.itemType),
      })).filter((s) => s.items.length > 0),
    [items]
  );

  const setDraft = (productId: string, next: Draft) =>
    onChange({ ...drafts, [productId]: next });

  const draftFor = (item: ClosingReportItem): Draft =>
    drafts[item.productId] ?? emptyDraft(item);

  if (items.length === 0) {
    return (
      <div className="co-empty">
        <p>No items assigned to you — nothing to report. You can close the job.</p>
      </div>
    );
  }

  // ── Step 1 ────────────────────────────────────────────────────────────────
  // One question, two buttons, and the left-hand one ends the flow. This is the
  // whole point of PDF #2's fast path: the common case is "nothing changed",
  // and it must cost one tap rather than a survey.
  if (!editing) {
    return (
      <div className="cir-gate">
        <h3 className="cir-gate-q">Any product levels changed?</h3>
        <p className="cir-gate-sub">
          Only tell us about items that are low, empty, missing, damaged or that
          you counted. Everything you don&apos;t touch stays exactly as it is —
          nothing is deducted automatically.
        </p>
        <button
          type="button"
          className="cir-gate-btn"
          disabled={disabled}
          onClick={() => onEditingChange(true)}>
          Update inventory
          <span className="cir-gate-btn-sub">
            {items.length} item{items.length === 1 ? "" : "s"} in your kit
          </span>
        </button>
      </div>
    );
  }

  // ── Step 2 ────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="cir-banner">
        Tap only the items that changed. Anything you leave alone is not
        reported.
      </div>

      {grouped.map((section) => (
        <div key={section.itemType} className="pju-section">
          <div className="pju-section-head">
            <span className="pju-section-icon" aria-hidden="true">
              {section.itemType === "LIQUID"
                ? "◍"
                : section.itemType === "COUNTABLE_CONSUMABLE"
                  ? "▤"
                  : "⚒"}
            </span>
            <div>
              <h3>{section.title}</h3>
              <p>{section.prompt}</p>
            </div>
          </div>

          {section.items.map((item) => {
            const draft = draftFor(item);
            const answered = isAnswered(draft);
            const flagged = isClockOutFieldError(failure, item.productId);
            return (
              <div
                key={item.productId}
                className={`pju-card${answered ? " cir-answered" : ""}`}
                style={clockOutFieldStyle(flagged)}>
                <div className="pju-card-head">
                  <span className="pju-card-name">{item.name}</span>
                  <span className="pju-card-stock">{onRecord(item)}</span>
                </div>

                {draft.kind === "LEVEL" && (
                  <div className="pju-pills cir-pills-5">
                    {LIQUID_LEVELS.map((level) => (
                      <button
                        key={level}
                        type="button"
                        disabled={disabled}
                        aria-pressed={draft.levelStatus === level}
                        className={`pju-pill${draft.levelStatus === level ? " selected" : ""}`}
                        onClick={() =>
                          setDraft(item.productId, {
                            ...draft,
                            levelStatus: draft.levelStatus === level ? null : level,
                          })
                        }>
                        <span className="lbl">{LIQUID_LEVEL_LABEL[level]}</span>
                      </button>
                    ))}
                  </div>
                )}

                {draft.kind === "CONDITION" && (
                  <div className="pju-pills cir-pills-2">
                    {EQUIPMENT_CONDITIONS.map((condition) => (
                      <button
                        key={condition}
                        type="button"
                        disabled={disabled}
                        aria-pressed={draft.condition === condition}
                        className={`pju-pill${draft.condition === condition ? " selected" : ""}`}
                        onClick={() =>
                          setDraft(item.productId, {
                            ...draft,
                            condition: draft.condition === condition ? null : condition,
                          })
                        }>
                        <span className="lbl">
                          {EQUIPMENT_CONDITION_LABEL[condition]}
                        </span>
                        <span className="hint">
                          {EQUIPMENT_CONDITION_HINT[condition]}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {draft.kind === "COUNT" && (
                  <>
                    <div className="cir-count-row">
                      <button
                        type="button"
                        className="cir-step"
                        aria-label={`One fewer ${item.name}`}
                        disabled={disabled}
                        onClick={() => {
                          const current = Number(draft.quantity.trim() || item.quantity);
                          setDraft(item.productId, {
                            ...draft,
                            quantity: String(Math.max(0, Math.floor(current) - 1)),
                          });
                        }}>
                        −
                      </button>
                      <input
                        className="co-input cir-count-input"
                        type="number"
                        inputMode="numeric"
                        step="1"
                        min="0"
                        max={MAX_KIT_QUANTITY}
                        disabled={disabled}
                        value={draft.quantity}
                        onChange={(e) =>
                          setDraft(item.productId, { ...draft, quantity: e.target.value })
                        }
                        // Never prefilled. The p.3 screenshot's faint autofilled
                        // "1" is exactly what a cleaner submits by accident.
                        placeholder={`How many ${item.unit} left?`}
                        aria-label={`${item.name} remaining`}
                        aria-invalid={flagged || undefined}
                      />
                      <button
                        type="button"
                        className="cir-step"
                        aria-label={`One more ${item.name}`}
                        disabled={disabled}
                        onClick={() => {
                          const current = Number(draft.quantity.trim() || item.quantity);
                          setDraft(item.productId, {
                            ...draft,
                            quantity: String(Math.min(MAX_KIT_QUANTITY, Math.floor(current) + 1)),
                          });
                        }}>
                        +
                      </button>
                    </div>
                    <div className="pju-pills cir-pills-5">
                      {COUNTABLE_STATUSES.map((status) => (
                        <button
                          key={status}
                          type="button"
                          disabled={disabled}
                          aria-pressed={draft.status === status}
                          title={COUNTABLE_STATUS_HINT[status]}
                          className={`pju-pill${draft.status === status ? " selected" : ""}`}
                          onClick={() =>
                            setDraft(item.productId, {
                              ...draft,
                              status: draft.status === status ? null : status,
                            })
                          }>
                          <span className="lbl">{COUNTABLE_STATUS_LABEL[status]}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {/* The note only appears once there is something to annotate —
                    an empty textarea under every row is noise on a phone. */}
                {answered && (
                  <input
                    className="co-input cir-note"
                    type="text"
                    maxLength={CLOSING_NOTE_MAX}
                    disabled={disabled}
                    value={draft.note}
                    onChange={(e) =>
                      setDraft(item.productId, { ...draft, note: e.target.value })
                    }
                    placeholder="Add a note (optional)"
                    aria-label={`Note about ${item.name}`}
                  />
                )}

                {answered && (
                  <button
                    type="button"
                    className="cir-clear"
                    disabled={disabled}
                    onClick={() => setDraft(item.productId, emptyDraft(item))}>
                    Clear this item
                  </button>
                )}

                {flagged && failure && <ClockOutFieldNote state={failure} />}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

export type { Draft as ClosingReportDraft };
