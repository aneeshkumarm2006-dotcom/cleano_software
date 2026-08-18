"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { reportDamagedItem } from "@/app/admin/actions/reportDamagedItem";
import {
  INVENTORY_ISSUE_TYPES,
  ISSUE_HINT,
  ISSUE_LABEL,
  needsRestock,
  writesOffCompanyStock,
  type InventoryIssueType,
} from "@/lib/inventory-issues";
import { createInventoryRequest } from "@/app/admin/actions/createInventoryRequest";
import { updateMyInventoryCount } from "@/app/admin/actions/updateMyInventoryCount";
import { updateMyItemCondition } from "@/app/admin/actions/updateMyItemCondition";
import type { ItemAttentionState, AttentionTone } from "@/lib/inventory-thresholds";
import {
  EQUIPMENT_CONDITIONS,
  EQUIPMENT_CONDITION_HINT,
  EQUIPMENT_CONDITION_LABEL,
  LIQUID_LEVEL_LABEL,
  type EquipmentCondition,
  type LiquidLevel,
} from "@/lib/inventory-status";
import type { ItemType } from "@/lib/item-type";
import { parseQuantityInput } from "@/lib/quantity-input";
import { addMyInventoryItem } from "./addMyInventoryItem";

interface PendingRequest {
  quantity: number;
  createdAt: string;
}

interface InventoryItem {
  id: string;
  productId: string;
  productName: string;
  productDescription: string | null;
  unit: string;
  quantity: number;
  itemType: ItemType;
  refillThreshold: number;
  usesDefaultThreshold: boolean;
  assignedAt: string;
  updatedAt: string;
  /** Computed server-side by itemAttentionState() — never re-derived here. */
  attention: ItemAttentionState;
  condition: EquipmentCondition | null;
  levelStatus: LiquidLevel | null;
  statusNotes: string | null;
  statusUpdatedAt: string | null;
  isLow: boolean;
  isOutOfStock: boolean;
  pendingRequest: PendingRequest | null;
}

/**
 * Tone → pill class. New classes, not a re-use of `.cl-pill.low`: a tool that
 * needs a service is not "low", and sharing the class is how the two concepts
 * would drift back together the next time someone restyles one of them.
 */
const PILL_CLASS: Record<AttentionTone, string> = {
  ok: "cond-ok",
  warn: "cond-warn",
  critical: "cond-alert",
};

/**
 * The same three tones in the consumable palette that already exists. Mapping
 * rather than re-deriving keeps one rule behind both sets of pills — before
 * this, consumables painted themselves from `isLow`/`isOutOfStock`, which a
 * liquid's REPORTED level (Stage 3) never reaches.
 */
const CONSUMABLE_PILL_CLASS: Record<AttentionTone, string> = {
  ok: "ok",
  warn: "low",
  critical: "empty",
};

/** Reusable tools report a condition; nothing about them "runs low" (PDF #4). */
function isEquipment(item: InventoryItem): boolean {
  return item.itemType === "REUSABLE_EQUIPMENT";
}

interface Location {
  id: string;
  name: string;
  address: string | null;
}

interface CatalogProduct {
  id: string;
  name: string;
  unit: string | null;
}

interface MyInventoryClientProps {
  items: InventoryItem[];
  locations?: Location[];
  catalog?: CatalogProduct[];
}

/**
 * Shared modal shell — a keyboard-safe bottom sheet (Stage 6 · PDF #3).
 *
 * The p.3 screenshot shows the failure this replaces: the old shell was a
 * centred, unbounded box with the action row as its last child, so the moment
 * the iOS keyboard opened, Save and Cancel were underneath it and the cleaner
 * had no way to submit the form they had just filled in.
 *
 * Three things fix that, and all three matter:
 *
 *  1. STRUCTURE — head / scrolling body / footer. The footer lives outside the
 *     scroller (`footer` prop rather than the last child), so it cannot be
 *     scrolled away or pushed down by a growing body.
 *  2. HEIGHT — capped at the *visual* viewport, which is the one that shrinks
 *     when the keyboard opens. `dvh` alone is not enough on iOS: `position:
 *     fixed` is measured against the layout viewport, which the keyboard does
 *     not change.
 *  3. OFFSET — the sheet is bottom-anchored on a phone, so it is also lifted by
 *     the keyboard's height (`--cl-kb-inset`). Without that, capping the height
 *     just makes a short sheet that is still behind the keyboard.
 *
 * ...and a fourth, added after all three of the above were already right and the
 * footer was STILL unreachable on a phone:
 *
 *  4. STACKING — the sheet is rendered into `<body>`, not where it sits in the
 *     JSX. `.cl-page-wrap` carries a filling `opacity` fade-in, which makes it a
 *     stacking context; every z-index inside it is then resolved against the
 *     page rather than against the app shell, so the crew app's fixed bottom tab
 *     bar (z-index 55, a child of the root context) painted straight over the
 *     sheet's footer and took the taps aimed at Save and Cancel with it. No
 *     value on `.cl-sheet-overlay` can win that from inside the trap; leaving
 *     the trap can. A portal also means an ancestor growing a transform, filter
 *     or its own overflow later cannot quietly re-break this.
 *
 * Everything else is in `globals.css` under `.cl-sheet*`.
 */
function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Track the visual viewport so the sheet fits above the keyboard. Falls back
  // to the CSS default (88dvh, no offset) where visualViewport is unsupported.
  useEffect(() => {
    const vv = window.visualViewport;
    const overlay = overlayRef.current;
    if (!vv || !overlay) return;
    const apply = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      overlay.style.setProperty("--cl-kb-inset", `${Math.round(inset)}px`);
      overlay.style.setProperty("--cl-sheet-max", `${Math.round(vv.height - 24)}px`);
    };
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
    };
  }, []);

  // Escape closes, and the page behind stops scrolling while the sheet is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  /**
   * Bring the focused control into view once the keyboard has finished
   * animating. React's onFocus bubbles, so one handler on the scroller covers
   * every field inside it.
   */
  const handleFocus = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const el = e.target;
    if (
      !(el instanceof HTMLInputElement) &&
      !(el instanceof HTMLTextAreaElement) &&
      !(el instanceof HTMLSelectElement)
    ) {
      return;
    }
    window.setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 150);
  }, []);

  // Every sheet here is opened by a tap, so this never runs during the server
  // render — the guard is for the day one of them starts open.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="cl-sheet-overlay" ref={overlayRef} onClick={onClose}>
      <div
        className="cl-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}>
        <div className="cl-sheet-head">
          <h3 className="cl-sheet-title">{title}</h3>
        </div>
        <div className="cl-sheet-body" onFocus={handleFocus}>
          {children}
        </div>
        {footer && <div className="cl-sheet-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/**
 * A modal's current error, and whether it belongs to the quantity box.
 *
 * The field tag is what lets the box render `aria-invalid` and the red border —
 * a server-side failure ("product not found") must not paint the number field
 * as the thing that is wrong.
 */
type SheetError = { message: string; field?: "quantity" } | null;

/**
 * Shared props for every quantity box here.
 *
 * `type="text"` rather than `type="number"` on purpose: a number input silently
 * discards what the browser cannot parse, so typing "abc" leaves an empty box
 * and no explanation. Text + `inputMode="numeric"` still opens the numeric
 * keypad on a phone, but lets `parseQty` tell the cleaner what went wrong.
 * Selecting on focus means the first digit typed REPLACES a stale value instead
 * of landing beside it.
 */
const qtyInputProps = {
  type: "text" as const,
  inputMode: "numeric" as const,
  pattern: "[0-9]*",
  autoComplete: "off" as const,
  onFocus: (e: React.FocusEvent<HTMLInputElement>) => e.currentTarget.select(),
};

export default function MyInventoryClient({ items, catalog = [] }: MyInventoryClientProps) {
  // Consumables at or below their threshold PLUS tools whose condition isn't
  // Available (PDF #4). The "19 at or below refill threshold" hero in
  // images/page-04-img-1.png was inflated by tools a cleaner only ever needs
  // one of; `needsAttention` is false for those by construction.
  const needAttn = items.filter((i) => i.attention.needsAttention).length;
  const totalUnits = items.reduce((s, i) => s + i.quantity, 0);
  const hasItems = items.length > 0;

  /* ---------------------------- damage / loss ---------------------------- */
  const [damageItem, setDamageItem] = useState<InventoryItem | null>(null);
  // String, and empty to start: no autofilled `1` to delete (PDF #3).
  const [damageQty, setDamageQty] = useState("");
  const [damageReason, setDamageReason] = useState("");
  const [damageKind, setDamageKind] = useState<InventoryIssueType>("LOST");
  const [damageError, setDamageError] = useState<SheetError>(null);
  const [damageBusy, startDamage] = useTransition();

  function openDamage(item: InventoryItem) {
    setDamageItem(item);
    setDamageQty("");
    setDamageReason("");
    setDamageKind("LOST");
    setDamageError(null);
  }

  function submitDamage() {
    if (!damageItem) return;
    const qty = parseQuantityInput(damageQty, {
      min: 1,
      max: damageItem.quantity,
      unit: damageItem.unit,
    });
    if (!qty.ok) {
      setDamageError({ message: qty.error, field: "quantity" });
      return;
    }
    setDamageError(null);
    startDamage(async () => {
      const result = await reportDamagedItem({
        productId: damageItem.productId,
        quantity: qty.value,
        reason: damageReason,
        kind: damageKind,
      });
      if (!result.success) {
        setDamageError({ message: result.error ?? "Failed to report" });
        return;
      }
      setDamageItem(null);
    });
  }

  /* ---------------------------- refill request ---------------------------- */
  // Locally-requested ids, so the button flips to "Requested" straight away
  // (the server revalidation refreshes `pendingRequest` right behind it).
  const [justRequested, setJustRequested] = useState<Set<string>>(new Set());
  const [refillItem, setRefillItem] = useState<InventoryItem | null>(null);
  const [refillQty, setRefillQty] = useState("");
  const [refillReason, setRefillReason] = useState("");
  const [refillError, setRefillError] = useState<SheetError>(null);
  const [refillBusy, startRefill] = useTransition();

  function isPending(item: InventoryItem) {
    return !!item.pendingRequest || justRequested.has(item.productId);
  }

  function openRefill(item: InventoryItem) {
    setRefillItem(item);
    // Suggest topping back up to a comfortable level above the refill line. A
    // suggestion is fine — an *unclearable* one was the bug. This box is a
    // string like every other, so the cleaner can select it and type their own.
    const suggested = Math.max(
      1,
      Math.ceil(item.refillThreshold * 2 - item.quantity)
    );
    setRefillQty(String(suggested));
    setRefillReason("");
    setRefillError(null);
  }

  function submitRefill() {
    if (!refillItem) return;
    const qty = parseQuantityInput(refillQty, { min: 1 });
    if (!qty.ok) {
      setRefillError({ message: qty.error, field: "quantity" });
      return;
    }
    setRefillError(null);
    startRefill(async () => {
      const res = await createInventoryRequest({
        productId: refillItem.productId,
        quantity: qty.value,
        reason: refillReason.trim() || "Running low — refill requested",
      });
      if (!res.success) {
        setRefillError({ message: res.error ?? "Failed to request refill" });
        return;
      }
      setJustRequested((prev) => new Set(prev).add(refillItem.productId));
      setRefillItem(null);
    });
  }

  /* --------------------- starting inventory (add item) --------------------- */
  // Spec item 15: cleaners record what they already have on hand — products
  // not yet in the kit — without waiting for an admin assignment.
  const [addOpen, setAddOpen] = useState(false);
  const [addProductId, setAddProductId] = useState("");
  const [addQty, setAddQty] = useState("");
  const [addError, setAddError] = useState<SheetError>(null);
  const [addBusy, startAdd] = useTransition();
  const inKit = new Set(items.map((i) => i.productId));
  const addable = catalog.filter((p) => !inKit.has(p.id));

  function submitAdd() {
    if (!addProductId) {
      setAddError({ message: "Pick a product." });
      return;
    }
    const qty = parseQuantityInput(addQty, { min: 1 });
    if (!qty.ok) {
      setAddError({ message: qty.error, field: "quantity" });
      return;
    }
    setAddError(null);
    startAdd(async () => {
      const res = await addMyInventoryItem({ productId: addProductId, quantity: qty.value });
      if (!res.success) {
        setAddError({ message: res.error ?? "Failed to add item" });
        return;
      }
      setAddOpen(false);
      setAddProductId("");
      setAddQty("");
    });
  }

  /* ------------------------- cleaner count correction ------------------------- */
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editError, setEditError] = useState<SheetError>(null);
  const [editBusy, startEdit] = useTransition();

  function openEdit(item: InventoryItem) {
    setEditItem(item);
    // Deliberately EMPTY, not seeded with the stored count (PDF #3). This is a
    // recount: the number on record is what the cleaner is checking against, so
    // it belongs in the label as context, not under their cursor as a value they
    // have to clear before they can type the one they just counted.
    setEditQty("");
    setEditReason("");
    setEditError(null);
  }

  function submitEdit() {
    if (!editItem) return;
    const qty = parseQuantityInput(editQty, { min: 0 });
    if (!qty.ok) {
      setEditError({ message: qty.error, field: "quantity" });
      return;
    }
    // A reason is still required — the audit trail is useless without one — but
    // the requirement SPEAKS now. `editBusy || !editReason.trim()` used to be
    // the whole of the button's `disabled`, so a cleaner who typed "abc" into
    // the count box watched Save go flat and was told nothing about either
    // problem. "Validation on submit, not per keystroke" only means anything if
    // the cleaner can submit and be told what is wrong.
    if (editBusy || !editReason.trim()) {
      setEditError({
        message: editBusy
          ? "Still saving — give it a moment."
          : "Add a reason so admin can see why the count changed.",
      });
      return;
    }
    setEditError(null);
    startEdit(async () => {
      const res = await updateMyInventoryCount({
        productId: editItem.productId,
        quantity: qty.value,
        reason: editReason,
      });
      if (!res.success) {
        setEditError({ message: res.error ?? "Failed to update count" });
        return;
      }
      setEditItem(null);
    });
  }

  /* ------------------------- equipment condition (PDF #4) ------------------- */
  // The tool-shaped replacement for "Request refill". A scraper is never low;
  // it is Available, Missing, Damaged, Needs replacement or Needs maintenance.
  const [condItem, setCondItem] = useState<InventoryItem | null>(null);
  const [condValue, setCondValue] = useState<EquipmentCondition>("AVAILABLE");
  const [condNote, setCondNote] = useState("");
  const [condError, setCondError] = useState<SheetError>(null);
  const [condBusy, startCond] = useTransition();

  function openCondition(item: InventoryItem) {
    setCondItem(item);
    setCondValue(item.condition ?? "AVAILABLE");
    setCondNote(item.statusNotes ?? "");
    setCondError(null);
  }

  function submitCondition() {
    if (!condItem) return;
    setCondError(null);
    startCond(async () => {
      const res = await updateMyItemCondition({
        productId: condItem.productId,
        condition: condValue,
        note: condNote,
      });
      if (!res.success) {
        setCondError({ message: res.error ?? "Failed to update condition" });
        return;
      }
      setCondItem(null);
    });
  }

  return (
    <div className="cl-page-wrap">
      <div className="cl-page-head">
        <div>
          <h1 className="cl-page-title">My inventory</h1>
          <p className="cl-page-sub">Equipment and supplies assigned to you.</p>
        </div>
      </div>

      {/* Hero */}
      <div className="cl-inv-hero">
        <div className="cl-inv-hero-main">
          <span className="greet-label">Your kit</span>
          <h2>
            {items.length} item{items.length === 1 ? "" : "s"} <em>in your bag.</em>
          </h2>
          <p className="desc">
            {!hasItems
              ? "Nothing assigned yet — pick up your starter supplies from storage."
              : needAttn === 0
                ? "You're fully stocked. Nice work keeping the kit topped up."
                : `${needAttn} ${needAttn === 1 ? "item needs" : "items need"} attention — request a refill, report a tool's condition, or pick replacements up from storage.`}
          </p>
          <div className="cl-inv-hero-actions">
            <a href="/cleaners/my-inventory/checkout" className="cl-inv-hero-btn">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>
              Pick up from storage
            </a>
            {addable.length > 0 && (
              <button
                type="button"
                className="cl-inv-hero-btn"
                onClick={() => { setAddOpen(true); setAddError(null); }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Add item I already have
              </button>
            )}
          </div>
        </div>

        {/* Stat cards are meaningless with an empty kit — hide them until there
            is something to count. */}
        {hasItems && (
          <>
            <div className={`cl-inv-hero-stat${needAttn > 0 ? " alert" : ""}`}>
              <div className="top">
                <span>Needs attention</span>
                <span className="icon-bubble">
                  {needAttn > 0 ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  )}
                </span>
              </div>
              <div className="big">{needAttn}</div>
              {/* Not "at or below refill threshold" any more — that phrasing
                  was the lie in images/page-04-img-1.png, where 19 included
                  tools a cleaner only ever needs one of. */}
              <div className="sub">{needAttn === 0 ? "All items stocked" : `${needAttn} low, empty or needing repair`}</div>
            </div>

            <div className="cl-inv-hero-stat">
              <div className="top">
                <span>Total units</span>
                <span className="icon-bubble">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
                </span>
              </div>
              <div className="big">{totalUnits}</div>
              <div className="sub">across {items.length} item{items.length === 1 ? "" : "s"}</div>
            </div>
          </>
        )}
      </div>

      {/* Section header — only once there's something to list. */}
      {hasItems && (
        <div className="cl-inv-section">
          <h2>
            Assigned items
            <span className="count">{items.length}</span>
          </h2>
        </div>
      )}

      {!hasItems ? (
        <div className="cl-empty-block">
          <div className="icon-bubble">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
          </div>
          <div>No items assigned yet. <a href="/cleaners/my-inventory/checkout" style={{ color: "var(--primary)", textDecoration: "underline" }}>Pick up from storage.</a></div>
        </div>
      ) : (
        <div className="cl-inv-list">
          {items.map((item) => {
            const equipment = isEquipment(item);
            const pct = Math.min(100, (item.quantity / Math.max(item.refillThreshold * 2, 1)) * 100);
            const threshPct = Math.min(100, (item.refillThreshold / Math.max(item.refillThreshold * 2, 1)) * 100);
            // Row tint and pill both come off the one server-computed state.
            const statusCls =
              item.attention.tone === "critical"
                ? "empty"
                : item.attention.tone === "warn"
                  ? "low"
                  : "";
            // Both branches now come off the one server-computed state. The
            // consumable classes are the tone under their old names, so a
            // liquid reporting "Low" paints exactly as a countable at its
            // threshold does — and a bottle reported empty stops reading "OK"
            // just because nothing deducts millilitres from it any more.
            const pillCls = equipment
              ? PILL_CLASS[item.attention.tone]
              : CONSUMABLE_PILL_CLASS[item.attention.tone];
            const pending = isPending(item);
            // Refills are a consumable concept. Equipment gets condition
            // actions instead — never "request a refill" (PDF #4).
            const needsRefill = !equipment && (item.isLow || item.isOutOfStock);
            // A liquid that somebody has reported a level for. Its count is a
            // historical artefact from Stage 3 onward, so the level is what
            // this row talks about.
            const reportedLevel =
              item.attention.kind === "LEVEL" ? item.attention.level : null;

            return (
              <article key={item.id} className={`cl-inv-row ${statusCls}`}>
                <div className="ir-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>
                </div>

                <div className="ir-meta">
                  <div className="name-row">
                    <span className="ir-name">{item.productName}</span>
                    {/* Equipment shows its CONDITION here — "Available",
                        "Damaged" — where a consumable shows Empty/Low/OK. */}
                    <span className={`cl-pill ${pillCls}`}>
                      {item.attention.label}
                    </span>
                    {pending && !equipment && (
                      <span className="cl-pill pending">Refill requested</span>
                    )}
                  </div>
                  {item.productDescription && (
                    <p className="ir-desc">{item.productDescription}</p>
                  )}
                  {needsRefill && !pending && (
                    <p className="ir-desc" style={{ color: item.isOutOfStock ? "var(--error-text)" : "var(--amber-800)", fontWeight: 600 }}>
                      {item.isOutOfStock
                        ? "Out of stock — request a refill."
                        : reportedLevel
                          // A liquid's count no longer moves (nothing deducts
                          // millilitres), so quoting "1 ml left" here would be
                          // reading a number that has been frozen since the day
                          // it was assigned. Quote what the cleaner reported.
                          ? "You reported this as running low — request a refill."
                          : `Running low (${item.quantity} ${item.unit} left) — request a refill.`}
                    </p>
                  )}
                  {/* The equipment equivalent: what's wrong and what to do
                      about it. Never "request a refill" — one scraper is all a
                      cleaner needs, so the fix is a repair or a replacement. */}
                  {equipment && item.attention.needsAttention && (
                    <p className="ir-desc" style={{ color: item.attention.tone === "critical" ? "var(--error-text)" : "var(--amber-800)", fontWeight: 600 }}>
                      {item.attention.label} — reported to admin for review.
                    </p>
                  )}
                  {equipment && item.statusNotes && (
                    <p className="ir-desc">“{item.statusNotes}”</p>
                  )}
                </div>

                <div className="ir-meter">
                  {equipment ? (
                    /* No fill meter for a tool: there is nothing to fill. The
                       column carries the condition and when it was reported. */
                    <>
                      <div className="cl-inv-meter-head">
                        <span className="cl-inv-meter-qty">
                          {item.quantity}<span className="unit"> {item.unit}</span>
                        </span>
                        <span className="cl-inv-meter-thresh">Tool — no refill level</span>
                      </div>
                      <div className="ir-updated">
                        {item.statusUpdatedAt
                          ? `Condition reported ${new Date(item.statusUpdatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                          : "Condition not reported yet"}
                      </div>
                    </>
                  ) : reportedLevel ? (
                    /* A liquid, once somebody has reported its level. No fill
                       bar: the bar was drawn from `quantity ÷ threshold`, and
                       after Stage 3 nothing moves a liquid's quantity — it would
                       sit permanently full while the cleaner was telling us the
                       bottle is empty. The level IS the meter. */
                    <>
                      <div className="cl-inv-meter-head">
                        <span className="cl-inv-meter-qty">
                          {LIQUID_LEVEL_LABEL[reportedLevel]}
                        </span>
                        <span className="cl-inv-meter-thresh">Reported level</span>
                      </div>
                      <div className="ir-updated">
                        {item.statusUpdatedAt
                          ? `Reported ${new Date(item.statusUpdatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                          : `Updated ${new Date(item.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="cl-inv-meter-head">
                        <span className="cl-inv-meter-qty">
                          {item.quantity}<span className="unit"> {item.unit}</span>
                        </span>
                        <span className="cl-inv-meter-thresh">Refill at {item.refillThreshold}</span>
                      </div>
                      <div className="cl-inv-meter-bar">
                        <div className="cl-inv-meter-fill" style={{ width: `${pct}%` }} />
                        {item.refillThreshold > 0 && (
                          <span className="cl-inv-meter-thresh-mark" style={{ left: `calc(${threshPct}% - 1px)` }} />
                        )}
                      </div>
                      <div className="ir-updated">
                        Updated {new Date(item.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </div>
                    </>
                  )}
                </div>

                {/* 4th grid column — stays visible on mobile (the meter column
                    is hidden below 900px, which used to hide these actions). */}
                <div className="ir-actions" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {equipment ? (
                    <button
                      type="button"
                      className={`cl-action-btn${item.attention.needsAttention ? " solid" : ""}`}
                      onClick={() => openCondition(item)}
                      title="Tell admin what state this tool is in">
                      Update condition
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`cl-action-btn${needsRefill && !pending ? " solid" : ""}`}
                      onClick={() => openRefill(item)}
                      disabled={pending}
                      title={pending ? "A refill request is already pending" : "Request a refill from the warehouse"}>
                      {pending ? "Refill requested" : "Request refill"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="cl-action-btn"
                    onClick={() => openEdit(item)}
                    title="Correct the count if what you have doesn't match">
                    Update count
                  </button>
                  <button
                    type="button"
                    className="cl-action-btn"
                    onClick={() => openDamage(item)}
                    disabled={item.quantity <= 0}>
                    Report an issue
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Refill request */}
      {refillItem && (
        <Modal
          title={`Request refill: ${refillItem.productName}`}
          onClose={() => setRefillItem(null)}
          footer={
            <>
              <button type="button" className="cl-action-btn" onClick={() => setRefillItem(null)}>
                Cancel
              </button>
              <button type="button" className="cl-action-btn solid" onClick={submitRefill} disabled={refillBusy}>
                {refillBusy ? "Sending..." : "Send request"}
              </button>
            </>
          }>
          <p className="cl-sheet-intro">
            You have {refillItem.quantity} {refillItem.unit}. Admin gets a request and
            tops you up from the warehouse.
          </p>

          <label className="cl-field-label" htmlFor="cl-refill-qty">
            How many {refillItem.unit} do you need?
          </label>
          <input
            {...qtyInputProps}
            id="cl-refill-qty"
            className="cl-field-input qty"
            value={refillQty}
            onChange={(e) => setRefillQty(e.target.value)}
            aria-invalid={refillError?.field === "quantity" || undefined}
            aria-describedby="cl-refill-error"
          />

          <label className="cl-field-label" htmlFor="cl-refill-note">
            Note (optional)
          </label>
          <textarea
            id="cl-refill-note"
            className="cl-field-input"
            value={refillReason}
            onChange={(e) => setRefillReason(e.target.value)}
            rows={3}
            placeholder="e.g. need it before Friday's deep clean"
          />

          <p className="cl-field-error" id="cl-refill-error" aria-live="polite">
            {refillError?.message ?? ""}
          </p>
        </Modal>
      )}

      {/* Cleaner-side count correction */}
      {addOpen && (
        <Modal
          title="Add item I already have"
          onClose={() => setAddOpen(false)}
          footer={
            <>
              <button type="button" className="cl-action-btn" onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="cl-action-btn solid"
                /* Same rule as Save count: an unpicked product is refused by
                   `submitAdd` with "Pick a product.", not by a dead button. */
                disabled={addBusy}
                onClick={submitAdd}>
                {addBusy ? "Adding..." : "Add to my kit"}
              </button>
            </>
          }>
          <p className="cl-sheet-intro">
            Record supplies already in your kit (e.g. your starting inventory).
            The add is logged to the item&apos;s stock history.
          </p>

          <label className="cl-field-label" htmlFor="cl-add-product">
            Product
          </label>
          <select
            id="cl-add-product"
            className="cl-field-input"
            value={addProductId}
            onChange={(e) => setAddProductId(e.target.value)}>
            <option value="">Select a product…</option>
            {addable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.unit ? ` (${p.unit})` : ""}
              </option>
            ))}
          </select>

          <label className="cl-field-label" htmlFor="cl-add-qty">
            Quantity
          </label>
          <input
            {...qtyInputProps}
            id="cl-add-qty"
            className="cl-field-input qty"
            value={addQty}
            onChange={(e) => setAddQty(e.target.value)}
            placeholder="e.g. 2"
            aria-invalid={addError?.field === "quantity" || undefined}
            aria-describedby="cl-add-error"
          />

          <p className="cl-field-error" id="cl-add-error" aria-live="polite">
            {addError?.message ?? ""}
          </p>
        </Modal>
      )}

      {/* The modal from the p.3 screenshot. Everything the PDF complains about
          lives here: the faint labels, the stuck `1`, the invisible Reason
          placeholder, and the buttons behind the keyboard. */}
      {editItem && (
        <Modal
          title={`Update count: ${editItem.productName}`}
          onClose={() => setEditItem(null)}
          footer={
            <>
              <button type="button" className="cl-action-btn" onClick={() => setEditItem(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="cl-action-btn solid"
                /* Only the in-flight save disables this. Everything else the
                   sheet can refuse is refused by `submitEdit`, out loud. */
                disabled={editBusy}
                onClick={submitEdit}>
                {editBusy ? "Saving..." : "Save count"}
              </button>
            </>
          }>
          <p className="cl-sheet-intro">
            Recount what you actually have. The change is logged to the item&apos;s
            stock history so admin can see it.
          </p>

          <label className="cl-field-label" htmlFor="cl-edit-qty">
            Actual count in {editItem.unit} — currently {editItem.quantity}
          </label>
          <input
            {...qtyInputProps}
            id="cl-edit-qty"
            className="cl-field-input qty"
            value={editQty}
            onChange={(e) => setEditQty(e.target.value)}
            placeholder={`e.g. ${editItem.quantity}`}
            aria-invalid={editError?.field === "quantity" || undefined}
            aria-describedby="cl-edit-error"
          />

          <label className="cl-field-label" htmlFor="cl-edit-reason">
            Reason
          </label>
          <textarea
            id="cl-edit-reason"
            className="cl-field-input"
            value={editReason}
            onChange={(e) => setEditReason(e.target.value)}
            rows={3}
            placeholder="e.g. recounted the van — two bottles were already empty"
          />
          <p className="cl-field-help">
            Lost, broken or used-up items should go through <strong>Report an issue</strong> so
            master stock is adjusted too.
          </p>

          <p className="cl-field-error" id="cl-edit-error" aria-live="polite">
            {editError?.message ?? ""}
          </p>
        </Modal>
      )}

      {/* Equipment condition (PDF #4) */}
      {condItem && (
        <Modal
          title={`Update condition: ${condItem.productName}`}
          onClose={() => setCondItem(null)}
          footer={
            <>
              <button type="button" className="cl-action-btn" onClick={() => setCondItem(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="cl-action-btn solid"
                onClick={submitCondition}
                disabled={condBusy}>
                {condBusy ? "Saving..." : "Save condition"}
              </button>
            </>
          }>
          <p className="cl-sheet-intro">
            This is a reusable tool, so it doesn&apos;t run low — tell admin what
            state it&apos;s in. Nothing is deducted from your kit.
          </p>

          <div className="cl-choice-grid" role="group" aria-label="Tool condition">
            {EQUIPMENT_CONDITIONS.map((c) => (
              <button
                key={c}
                type="button"
                className="cl-choice"
                aria-pressed={condValue === c}
                onClick={() => setCondValue(c)}>
                <span className="lbl">{EQUIPMENT_CONDITION_LABEL[c]}</span>
                <span className="hint">{EQUIPMENT_CONDITION_HINT[c]}</span>
              </button>
            ))}
          </div>

          <label className="cl-field-label" htmlFor="cl-cond-note">
            Note (optional)
          </label>
          <textarea
            id="cl-cond-note"
            className="cl-field-input"
            value={condNote}
            onChange={(e) => setCondNote(e.target.value)}
            rows={3}
            placeholder="e.g. handle cracked, still usable for now"
          />

          <p className="cl-field-error" aria-live="polite">
            {condError?.message ?? ""}
          </p>
        </Modal>
      )}

      {/* Damage / loss report */}
      {damageItem && (
        <Modal
          title={`Report ${damageItem.productName}`}
          onClose={() => setDamageItem(null)}
          footer={
            <>
              <button type="button" className="cl-action-btn" onClick={() => setDamageItem(null)}>
                Cancel
              </button>
              {/* Red stays here only: this is the genuinely destructive confirm
                  (it writes stock off both the kit and master inventory). */}
              <button
                type="button"
                onClick={submitDamage}
                disabled={damageBusy}
                style={{
                  minHeight: 44,
                  padding: "0 18px",
                  fontSize: 13.5,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  background: "#dc2626",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  cursor: damageBusy ? "not-allowed" : "pointer",
                  opacity: damageBusy ? 0.6 : 1,
                }}>
                {damageBusy ? "Reporting..." : "Report"}
              </button>
            </>
          }>
          <p className="cl-sheet-intro">
            {writesOffCompanyStock(damageKind)
              ? "This deducts from your kit and writes the item off company stock, and alerts admin."
              : needsRestock(damageKind)
              ? "This reduces your kit and tells admin you may need a restock."
              : "This reduces your kit and flags it for admin to review."}
          </p>

          {/* Item 15: four issue types, each with a hint so the right one
              gets picked — they behave differently in the books. */}
          <div className="cl-choice-grid two" role="group" aria-label="What happened">
            {INVENTORY_ISSUE_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className="cl-choice"
                aria-pressed={damageKind === t}
                onClick={() => setDamageKind(t)}>
                <span className="lbl">{ISSUE_LABEL[t]}</span>
                <span className="hint">{ISSUE_HINT[t]}</span>
              </button>
            ))}
          </div>

          <label className="cl-field-label" htmlFor="cl-damage-qty">
            Quantity — you have {damageItem.quantity} {damageItem.unit}
          </label>
          <input
            {...qtyInputProps}
            id="cl-damage-qty"
            className="cl-field-input qty"
            value={damageQty}
            onChange={(e) => setDamageQty(e.target.value)}
            placeholder="e.g. 1"
            aria-invalid={damageError?.field === "quantity" || undefined}
            aria-describedby="cl-damage-error"
          />

          <label className="cl-field-label" htmlFor="cl-damage-reason">
            What happened? (optional)
          </label>
          <textarea
            id="cl-damage-reason"
            className="cl-field-input"
            value={damageReason}
            onChange={(e) => setDamageReason(e.target.value)}
            rows={3}
            placeholder="e.g. spray nozzle broke during job #2438"
          />

          <p className="cl-field-error" id="cl-damage-error" aria-live="polite">
            {damageError?.message ?? ""}
          </p>
        </Modal>
      )}
    </div>
  );
}
