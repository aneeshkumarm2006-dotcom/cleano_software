"use client";

import { useState } from "react";
import { AddOnSelection, BookingDraft, SERVICE_TYPES, RoomType, needsPopup } from "../types";
import { Field, Input, Button } from "@/components/customer/Field";
import {
  BOOKING_PAGE_DEFAULTS,
  resolveVisibleFields,
  resolveVisibleFrequencyOptions,
  type BookingFieldConfig,
  type BookingPageConfig,
} from "@/lib/booking-page-config";
import CustomerModal from "@/components/customer/Modal";
import { NumberStepper, QuantityStepper, ChoiceButton } from "@/components/customer/atoms";
import { addonIcon } from "@/lib/addon-icons";
import { MAX_ADDON_QUANTITY } from "@/lib/job-money";
import { normalizeJobType } from "@/lib/calendar-labels";
import {
  PROPERTY_TYPE_HINT,
  PROPERTY_TYPE_LABEL,
  PROPERTY_TYPES,
} from "@/lib/property-type";
import PremiumSelect from "@/components/ui/PremiumSelect";
import {
  NEW_ADDRESS,
  addressOptionLabel,
  stripDuplicatedApt,
  type SavedAddress,
} from "@/lib/client-address";
import { formatPropertySize, readPropertySize } from "@/lib/property-size";
import { checkServiceArea } from "../../actions/checkServiceArea";
import BookingPhotoUpload from "./BookingPhotoUpload";

const ROOM_LABELS: Record<RoomType, string> = {
  KITCHEN: "Kitchen",
  BATHROOM: "Bathroom",
  BEDROOM: "Bedroom",
  LIVING_ROOM: "Living room",
  LAUNDRY: "Laundry",
  OUTDOOR: "Outdoor / patio",
  WHOLE_HOME: "Whole home",
};

const ROOM_ORDER: RoomType[] = [
  "KITCHEN",
  "BATHROOM",
  "BEDROOM",
  "LIVING_ROOM",
  "LAUNDRY",
  "OUTDOOR",
  "WHOLE_HOME",
];

interface Props {
  draft: BookingDraft;
  onChange: (patch: Partial<BookingDraft>) => void;
  /**
   * The signed-in customer's saved addresses (item 2). Empty for a guest, or
   * for a customer whose book is still empty — either way the free-text path
   * below is unchanged, so booking without an account works exactly as before.
   */
  savedAddresses?: SavedAddress[];
  /** Server-computed base price (before add-ons/tax) for the current inputs. */
  basePrice?: number;
  /** Per-service-category recurring discount table (item 7). */
  freqDiscounts?: Record<string, Record<string, number>>;
  /** "What's included" text + graphic per service type (item 3). */
  serviceContent?: Record<string, { text: string; imageUrl: string }>;
  /** Admin-editable field layout (item 17). Defaults = today's rendering. */
  bookingPage?: BookingPageConfig;
}

/** An add-on shows when it has no service restriction, or includes this service. */
function addOnForService(a: { services?: string[] }, serviceType: string): boolean {
  return !a.services || a.services.length === 0 || a.services.includes(serviceType);
}

/**
 * Fields that render as a cell in the two-up stepper grid. Consecutive ones are
 * merged into a single grid below, so the default order keeps today's layout
 * while an admin reordering them still gets a sane result.
 */
const GRID_FIELDS = new Set([
  "bedCount",
  "bathCount",
  "halfBathCount",
  "squareFootage",
  "pcHours",
  "pcCleaners",
]);

/** Split an ordered field list into runs of grid cells and standalone blocks. */
function groupFields(
  fields: BookingFieldConfig[]
): { grid: boolean; items: BookingFieldConfig[] }[] {
  const out: { grid: boolean; items: BookingFieldConfig[] }[] = [];
  for (const f of fields) {
    const grid = GRID_FIELDS.has(f.key);
    const last = out[out.length - 1];
    if (last && last.grid && grid) last.items.push(f);
    else out.push({ grid, items: [f] });
  }
  return out;
}

export default function Step2Property({
  draft,
  onChange,
  savedAddresses = [],
  basePrice = 0,
  freqDiscounts = {},
  serviceContent = {},
  bookingPage = BOOKING_PAGE_DEFAULTS,
}: Props) {
  // Index into draft.addOns of the add-on whose pop-up is open (item 17). An
  // INDEX rather than a copy, so the row read in the modal is the live one.
  const [pendingIdx, setPendingIdx] = useState<number | null>(null);
  const pending = pendingIdx === null ? null : draft.addOns[pendingIdx] ?? null;

  // ── Saved addresses (item 2) ───────────────────────────────────────────────
  // `postalNotice` reports a coverage re-check triggered by picking an address
  // whose postal code differs from the one entered in step 1.
  const [postalNotice, setPostalNotice] = useState<string | null>(null);
  const [reChecking, setReChecking] = useState(false);
  /** Says which property details were filled in from the saved address (item 3). */
  const [sizeNotice, setSizeNotice] = useState<string | null>(null);

  async function onAddressChoice(v: string) {
    setPostalNotice(null);
    setSizeNotice(null);

    if (v === NEW_ADDRESS) {
      onChange({ addressId: null, address: "", aptNumber: "" });
      return;
    }

    const addr = savedAddresses.find((a) => a.id === v);
    if (!addr) return;

    // ── Property size from the saved address (item 3) ────────────────────────
    //
    // Only fields the address ACTUALLY records are copied. The draft starts at
    // sensible defaults (2 bed / 1 bath) and the customer may already have
    // adjusted them, so an address that knows nothing about its bathrooms must
    // leave the bathroom count alone rather than reset it — hence a patch built
    // from non-null values instead of a blanket overwrite.
    //
    // This can move the price, because the quote is priced off these numbers.
    // That is correct — it is the customer's own saved property — but it must
    // never be silent, which is what `sizeNotice` below is for.
    const size = readPropertySize(addr);
    const sizePatch: Partial<BookingDraft> = {};
    if (size.propertyType !== null) sizePatch.propertyType = size.propertyType;
    if (size.bedCount !== null) sizePatch.bedCount = size.bedCount;
    if (size.bathCount !== null) sizePatch.bathCount = size.bathCount;
    if (size.halfBathCount !== null) {
      sizePatch.halfBathCount = size.halfBathCount;
    }
    if (size.squareFootage !== null) {
      sizePatch.squareFootage = size.squareFootage;
    }

    onChange({
      addressId: addr.id,
      address: stripDuplicatedApt(addr.address, addr.aptNumber),
      aptNumber: addr.aptNumber ?? "",
      ...sizePatch,
    });

    const sizeLine = formatPropertySize(addr);
    if (sizeLine && Object.keys(sizePatch).length > 0) {
      setSizeNotice(`Filled in from your saved address: ${sizeLine}.`);
    }

    // The quote is priced against step 1's postal code (coverage, zone, travel
    // fee). Filling in an address from a DIFFERENT postal code and leaving that
    // untouched would quote one place and clean another, so re-run the check
    // and move the zone/fee with it rather than silently disagreeing.
    const nextPostal = (addr.postalCode ?? "").trim();
    if (!nextPostal || nextPostal.toUpperCase() === draft.postalCode.trim().toUpperCase()) {
      return;
    }

    setReChecking(true);
    const res = await checkServiceArea(nextPostal);
    setReChecking(false);
    if ("error" in res && res.error) return;

    const covered = "covered" in res ? res.covered : false;
    const zoneName = "zoneName" in res ? res.zoneName ?? null : null;
    const travelFee = "travelFee" in res ? res.travelFee ?? 0 : 0;
    onChange({ postalCode: nextPostal.toUpperCase(), postalCovered: covered, zoneName, travelFee });
    setPostalNotice(
      covered
        ? `Postal code updated to ${nextPostal.toUpperCase()}${
            zoneName ? ` · ${zoneName}` : ""
          }${travelFee > 0 ? ` · travel fee $${travelFee.toFixed(2)}` : ""}.`
        : `We don't currently service ${nextPostal.toUpperCase()}. Pick another address or get in touch.`
    );
  }
  const isPC = draft.serviceType === "POST_CONSTRUCTION";
  const isAirbnb = draft.serviceType === "AIRBNB";
  const isMoveInOut = draft.serviceType === "MOVE_IN_OUT";

  // Resolve this service's discount row from the admin config (item 7).
  const category = normalizeJobType(draft.serviceType) ?? "RESIDENTIAL";
  const discountRow = freqDiscounts[category] ?? freqDiscounts.RESIDENTIAL ?? {};

  // Admin-configured field layout for THIS service (item 17). Everything below
  // renders from this list rather than from hardcoded service checks.
  const fields = resolveVisibleFields(bookingPage, "property", draft.serviceType);
  const blocks = groupFields(fields);
  const freqOptions = resolveVisibleFrequencyOptions(bookingPage, draft.serviceType);

  // "What's included" content for the selected service (item 3).
  const activeContent = serviceContent[draft.serviceType];
  const hasContent =
    !!activeContent && (!!activeContent.text.trim() || !!activeContent.imageUrl);

  // Switching service hides add-ons that don't apply — deselect them so a hidden
  // add-on can't stay in the total.
  function selectService(value: string) {
    onChange({
      serviceType: value,
      frequency: "ONE_TIME",
      addOns: draft.addOns.map((a) =>
        a.selected && !addOnForService(a, value) ? { ...a, selected: false } : a
      ),
    });
  }

  const airbnbDiscount = discountRow[draft.frequency] ?? 0;

  /** One configured field. Label and help text come from the admin config. */
  function renderField(f: BookingFieldConfig) {
    switch (f.key) {
      // Saved-address picker — signed-in customers with a book only. Guests
      // and first-time customers see the plain address field, unchanged.
      case "savedAddress":
        if (savedAddresses.length === 0) return null;
        return (
          <Field key={f.key} label={f.label} htmlFor="prop-saved-addr" hint={f.helpText || undefined}>
            <PremiumSelect
              value={draft.addressId ?? NEW_ADDRESS}
              onChange={onAddressChoice}
              size="md"
              disabled={reChecking}
              options={[
                ...savedAddresses.map((a) => ({
                  value: a.id,
                  label: addressOptionLabel(a),
                })),
                { value: NEW_ADDRESS, label: "+ Use a new address" },
              ]}
            />
            {postalNotice && (
              <p
                style={{
                  marginTop: 6,
                  fontSize: 12.5,
                  color: draft.postalCovered === false ? "#dc2626" : "var(--primary-60)",
                }}>
                {postalNotice}
              </p>
            )}
            {/* Picking a saved address can change the quote, because the price
                is built from the room counts it just filled in. Say so (item 3)
                — a price that moves without explanation reads as a bug. */}
            {sizeNotice && (
              <p
                style={{
                  marginTop: 6,
                  fontSize: 12.5,
                  color: "var(--primary-60)",
                }}>
                {sizeNotice} You can change anything below.
              </p>
            )}
          </Field>
        );

      case "address":
        return (
          <Field key={f.key} label={f.label} htmlFor="prop-addr" hint={f.helpText || undefined}>
            <Input
              id="prop-addr"
              value={draft.address}
              onChange={(e) =>
                // Typing over a picked address detaches it, so submitBooking
                // treats it as a new one rather than linking the wrong row.
                onChange({ address: e.target.value, addressId: null })
              }
              placeholder="123 rue Sainte-Catherine, Montréal"
            />
          </Field>
        );

      case "aptNumber":
        return (
          <Field key={f.key} label={f.label} htmlFor="prop-apt" hint={f.helpText || undefined}>
            <Input
              id="prop-apt"
              value={draft.aptNumber}
              onChange={(e) => onChange({ aptNumber: e.target.value })}
              placeholder="e.g. Apt 12B"
            />
          </Field>
        );

      case "serviceType":
        return (
          <div key={f.key} className="cl-stack-12">
            <span className="cl-label">{f.label}</span>
            {f.helpText && (
              <p style={{ fontSize: 12, color: "var(--primary-60)", margin: 0, lineHeight: 1.5 }}>
                {f.helpText}
              </p>
            )}
            <div className="cl-grid-2">
              {SERVICE_TYPES.map((s) => (
                <ChoiceButton
                  key={s.value}
                  active={draft.serviceType === s.value}
                  title={s.label}
                  onClick={() => selectService(s.value)}
                />
              ))}
            </div>
            {hasContent && (
              <div
                className="cl-stack-12"
                style={{
                  marginTop: 8,
                  padding: "18px 20px",
                  borderRadius: 16,
                  background: "var(--primary-05, rgba(0,140,156,0.05))",
                  border: "1px solid var(--primary-15, rgba(0,140,156,0.15))",
                }}>
                <span className="cl-label" style={{ color: "var(--primary)" }}>
                  What&apos;s included
                </span>
                {activeContent?.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={activeContent.imageUrl}
                    alt="What's included in this service"
                    style={{
                      width: "100%",
                      borderRadius: 12,
                      display: "block",
                      maxHeight: 320,
                      objectFit: "cover",
                    }}
                  />
                )}
                {activeContent?.text.trim() && (
                  <p
                    style={{
                      margin: 0,
                      fontSize: 14,
                      lineHeight: 1.6,
                      color: "var(--primary-80, #0F172A)",
                      whiteSpace: "pre-wrap",
                    }}>
                    {activeContent.text}
                  </p>
                )}
              </div>
            )}
          </div>
        );

      // Apartment/condo vs house (Stage 9 / PDF #11). Two choice buttons, the
      // same control the service picker above uses, and re-tapping the active
      // one clears it — the field is optional, so "I'd rather not say" has to
      // stay reachable after a stray tap. It prices nothing: no quote re-run is
      // triggered and `computeBookingPrice` never sees it.
      case "propertyType":
        return (
          <div key={f.key} className="cl-stack-12">
            <span className="cl-label">{f.label}</span>
            {f.helpText && (
              <p style={{ fontSize: 12, color: "var(--primary-60)", margin: 0, lineHeight: 1.5 }}>
                {f.helpText}
              </p>
            )}
            <div className="cl-grid-2">
              {PROPERTY_TYPES.map((p) => (
                <ChoiceButton
                  key={p}
                  active={draft.propertyType === p}
                  title={PROPERTY_TYPE_LABEL[p]}
                  hint={PROPERTY_TYPE_HINT[p]}
                  onClick={() =>
                    onChange({ propertyType: draft.propertyType === p ? "" : p })
                  }
                />
              ))}
            </div>
          </div>
        );

      case "bedCount":
        return (
          <NumberStepper
            key={f.key}
            label={f.label}
            value={draft.bedCount}
            onChange={(v) => onChange({ bedCount: v })}
            min={0}
            max={8}
          />
        );
      case "bathCount":
        return (
          <NumberStepper
            key={f.key}
            label={f.label}
            value={draft.bathCount}
            onChange={(v) => onChange({ bathCount: v })}
            min={0}
            max={6}
          />
        );
      case "halfBathCount":
        return (
          <NumberStepper
            key={f.key}
            label={f.label}
            value={draft.halfBathCount}
            onChange={(v) => onChange({ halfBathCount: v })}
            min={0}
            max={4}
          />
        );
      case "squareFootage":
        return (
          <Field key={f.key} label={f.label} hint={f.helpText || undefined}>
            <Input
              value={draft.squareFootage || ""}
              onChange={(e) =>
                onChange({ squareFootage: parseInt(e.target.value) || 0 })
              }
              placeholder="e.g. 1200"
              inputMode="numeric"
            />
          </Field>
        );
      case "pcHours":
        return (
          <NumberStepper
            key={f.key}
            label={f.label}
            value={draft.pcHours}
            onChange={(v) => onChange({ pcHours: v })}
            min={4}
            max={24}
          />
        );
      case "pcCleaners":
        return (
          <NumberStepper
            key={f.key}
            label={f.label}
            value={draft.pcCleaners}
            onChange={(v) => onChange({ pcCleaners: v })}
            min={1}
            max={6}
          />
        );

      case "frequency":
        // Hidden by default for Move-in/out, Deep and Post-construction
        // (item 15) — those are one-off prices with no recurring discount.
        // An admin who hides every recurring option gets the same result: a
        // block offering only "One-time" is a choice with nothing to choose.
        if (!freqOptions.some((x) => x.value !== "ONE_TIME")) return null;
        return (
          <div key={f.key} className="cl-stack-12">
            <span className="cl-label">{f.label}</span>
            {f.helpText && (
              <p style={{ fontSize: 12, color: "var(--primary-60)", margin: 0, lineHeight: 1.5 }}>
                {f.helpText}
              </p>
            )}
            <div className="cl-grid-2">
              {freqOptions.map((opt) => {
                const pct = discountRow[opt.value] ?? 0;
                // Airbnb discounts every visit; other services discount the
                // 2nd+ visit (the first cleaning is always full price).
                const discountHint =
                  opt.value === "ONE_TIME" || pct <= 0
                    ? opt.hint || undefined
                    : isAirbnb
                      ? `${pct}% off every visit`
                      : `${pct}% off from your 2nd visit`;
                return (
                  <ChoiceButton
                    key={opt.value}
                    active={draft.frequency === opt.value}
                    title={opt.label}
                    hint={discountHint}
                    onClick={() =>
                      onChange({ frequency: opt.value as BookingDraft["frequency"] })
                    }
                  />
                );
              })}
            </div>
            {isAirbnb && airbnbDiscount > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderRadius: 12, background: "rgba(5,150,105,0.08)", border: "1px solid rgba(5,150,105,0.2)" }}>
                <span style={{ fontSize: 18, color: "#059669", fontWeight: 700 }}>−{airbnbDiscount}%</span>
                <span style={{ fontSize: 13, color: "#065f46" }}>
                  Recurring Airbnb discount applied to every visit.
                </span>
              </div>
            )}
          </div>
        );

      // Photos of the space (PDF #9, Stage 11). Post-construction is quoted from
      // these, so the field is visible + required + locked for that service —
      // see isLockedField in booking-page-config. Hidden everywhere else, which
      // is why there is no `isPC` test here: the config decides.
      case "photos":
        return (
          <div key={f.key} className="cl-stack-12">
            <span className="cl-label">{f.label}</span>
            {f.helpText && (
              <p style={{ fontSize: 12, color: "var(--primary-60)", margin: 0, lineHeight: 1.5 }}>
                {f.helpText}
              </p>
            )}
            <BookingPhotoUpload
              value={draft.photos}
              onChange={(photos) => onChange({ photos })}
              required={f.required}
            />
          </div>
        );

      case "addOns":
        return (
          <div key={f.key} className="cl-stack-12">
            <span className="cl-label">{f.label}</span>
            {f.helpText && (
              <p style={{ fontSize: 12, color: "var(--primary-60)", margin: 0, lineHeight: 1.5 }}>
                {f.helpText}
              </p>
            )}
            {renderAddOns()}
          </div>
        );

      default:
        return null;
    }
  }

  function renderAddOns() {
    const visible = draft.addOns.filter((a) => addOnForService(a, draft.serviceType));
    if (visible.length === 0) {
      return (
        <p style={{ fontSize: 13, color: "var(--primary-60)", margin: 0 }}>
          No add-ons available for this service.
        </p>
      );
    }
    return ROOM_ORDER.map((room) => {
      const items = draft.addOns
        .map((a, idx) => ({ a, idx }))
        .filter(({ a }) => (a.roomType ?? "WHOLE_HOME") === room && addOnForService(a, draft.serviceType));
      if (items.length === 0) return null;
      return (
        <div key={room} className="cl-stack-8" style={{ marginTop: 4 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--primary-60)",
            }}>
            {ROOM_LABELS[room]}
          </span>
          {/* Icon cards (spec item 22) — tap the card to toggle.
              The card is a <button>, so the quantity stepper (which is
              itself buttons) has to be its SIBLING inside the shell, not
              its child: nested buttons are invalid HTML and React renders
              them without complaint. The shell carries the visual chrome
              so the card can stay a real button with aria-pressed. */}
          <div className="cl-addon-grid">
            {items.map(({ a, idx }) => {
              const Icon = addonIcon(a);
              const patchAddOn = (patch: Partial<AddOnSelection>) => {
                const next = [...draft.addOns];
                next[idx] = { ...a, ...patch };
                onChange({ addOns: next });
              };
              return (
                <div
                  key={a.id ?? `${a.name}-${idx}`}
                  className={`cl-addon-card-shell ${a.selected ? "active" : ""}`}>
                  <button
                    type="button"
                    className="cl-addon-card"
                    aria-pressed={a.selected}
                    onClick={() => {
                      // A configured add-on explains itself BEFORE it is
                      // added; the selection commits from the modal.
                      if (needsPopup(a)) {
                        setPendingIdx(idx);
                        return;
                      }
                      patchAddOn(
                        a.selected
                          ? { selected: false, quantity: 0 }
                          : { selected: true, quantity: 1 }
                      );
                    }}>
                    {a.selected && <span className="cl-addon-check">✓</span>}
                    <span className="cl-addon-ic">
                      <Icon size={20} />
                    </span>
                    <span className="cl-addon-card-name">{a.name}</span>
                    <span className="cl-addon-card-price">
                      +${a.price.toFixed(2)}
                      {a.selected && a.quantity > 1 ? " each" : ""}
                    </span>
                  </button>
                  {a.selected && (
                    <QuantityStepper
                      compact
                      value={Math.max(1, a.quantity)}
                      min={1}
                      max={MAX_ADDON_QUANTITY}
                      ariaLabel={`${a.name} quantity`}
                      onChange={(q) => patchAddOn({ quantity: q })}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    });
  }

  return (
    <div className="cl-stack-32">
      <header className="cl-stack-8">
        <p className="cl-eyebrow">Step 2</p>
        <h1
          className="cl-display"
          style={{ fontSize: "clamp(34px, 4.4vw, 52px)" }}>
          Tell us about
          <br />
          your <em>{isPC ? "project." : "home."}</em>
        </h1>
        <p className="cl-subtitle">
          A few details so we can put together a price.
        </p>
      </header>

      {/* Every block below comes from the admin-editable booking-page config
          (item 17): which fields show for this service, in what order, and
          with what label and help text. Consecutive stepper/number fields
          collapse into one two-up grid so the default order keeps the layout
          the page has today. */}
      {blocks.map((block, bi) => {
        if (!block.grid) {
          const node = renderField(block.items[0]);
          return node ? <div key={block.items[0].key}>{node}</div> : null;
        }
        const cells = block.items.map(renderField).filter(Boolean);
        if (cells.length === 0) return null;
        const hasSqft = block.items.some((x) => x.key === "squareFootage");
        const hasPc = block.items.some((x) => x.key === "pcHours" || x.key === "pcCleaners");
        return (
          <div key={`grid-${bi}`}>
            <div className="cl-grid-2">{cells}</div>
            {hasSqft && isMoveInOut && (
              <p
                style={{
                  fontSize: 12.5,
                  color: "var(--primary-60)",
                  margin: "8px 0 0",
                  lineHeight: 1.5,
                }}>
                {draft.squareFootage > 0
                  ? `Move-in/out is priced by square footage — estimated $${basePrice.toFixed(2)} before tax.`
                  : "Move-in/out is priced by square footage. Enter it above to see your price."}
              </p>
            )}
            {hasPc && isPC && (
              <div
                style={{
                  marginTop: 12,
                  background: "var(--primary-10)",
                  borderRadius: 12,
                  padding: "14px 18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--primary-60)", marginBottom: 2 }}>
                    Estimate ({draft.pcHours} hour{draft.pcHours !== 1 ? "s" : ""}
                    {draft.pcCleaners
                      ? `, ${draft.pcCleaners} cleaner${draft.pcCleaners !== 1 ? "s" : ""}`
                      : ""}
                    )
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "var(--primary)" }}>
                    ${basePrice.toFixed(0)}{" "}
                    <span style={{ fontSize: 13, fontWeight: 400, color: "var(--primary-60)" }}>
                      before tax
                    </span>
                  </div>
                </div>
                {/* PDF #9, Stage 11: the old line promised an "on-site
                    assessment" that nobody was scheduled to do. The real flow is
                    photos in, quote back — so say that. */}
                <span style={{ fontSize: 11, color: "var(--primary-50)", maxWidth: 148, lineHeight: 1.4 }}>
                  Estimate only — we send your final quote after reviewing your
                  photos.
                </span>
              </div>
            )}
          </div>
        );
      })}

      {/* Add-on pop-up (item 17). Cancel — including Escape and a backdrop
          click, both of which CustomerModal already treats as onClose — leaves
          the add-on UNSELECTED, which is the right default for a message the
          customer has just been asked to read. */}
      <CustomerModal
        open={pending !== null}
        onClose={() => setPendingIdx(null)}
        title={pending?.popupTitle?.trim() || pending?.name || "Add-on"}>
        {pending && (
          <div className="cl-stack-12">
            {pending.popupMessage?.trim() && (
              <p style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap", margin: 0 }}>
                {pending.popupMessage}
              </p>
            )}
            {pending.popupRequestPhoto && (
              <p style={{ fontSize: 13, color: "var(--primary-70)", margin: 0 }}>
                We&apos;ll email you to ask for a photo so we can confirm the
                exact price before your visit.
              </p>
            )}
            <p style={{ fontSize: 13, color: "var(--primary-70)", margin: 0 }}>
              Adds <strong>${pending.price.toFixed(2)}</strong> to your booking.
            </p>
            <div className="cl-modal-actions">
              <Button variant="ghost" onClick={() => setPendingIdx(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (pendingIdx === null) return;
                  const next = [...draft.addOns];
                  next[pendingIdx] = {
                    ...next[pendingIdx],
                    selected: true,
                    quantity: 1,
                  };
                  onChange({ addOns: next });
                  setPendingIdx(null);
                }}>
                Add to booking
              </Button>
            </div>
          </div>
        )}
      </CustomerModal>
    </div>
  );
}
