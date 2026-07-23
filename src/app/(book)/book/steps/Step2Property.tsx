"use client";

import { BookingDraft, SERVICE_TYPES, FREQUENCIES, AIRBNB_FREQUENCIES, RoomType } from "../types";
import { Field, Input } from "@/components/customer/Field";
import { NumberStepper, ChoiceButton } from "@/components/customer/atoms";
import { addonIcon } from "@/lib/addon-icons";
import { normalizeJobType } from "@/lib/calendar-labels";

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
  /** Server-computed base price (before add-ons/tax) for the current inputs. */
  basePrice?: number;
  /** Per-service-category recurring discount table (item 7). */
  freqDiscounts?: Record<string, Record<string, number>>;
  /** "What's included" text + graphic per service type (item 3). */
  serviceContent?: Record<string, { text: string; imageUrl: string }>;
}

/** An add-on shows when it has no service restriction, or includes this service. */
function addOnForService(a: { services?: string[] }, serviceType: string): boolean {
  return !a.services || a.services.length === 0 || a.services.includes(serviceType);
}

export default function Step2Property({ draft, onChange, basePrice = 0, freqDiscounts = {}, serviceContent = {} }: Props) {
  const isPC = draft.serviceType === "POST_CONSTRUCTION";
  const isAirbnb = draft.serviceType === "AIRBNB";
  const isMoveInOut = draft.serviceType === "MOVE_IN_OUT";

  // Resolve this service's discount row from the admin config (item 7).
  const category = normalizeJobType(draft.serviceType) ?? "RESIDENTIAL";
  const discountRow = freqDiscounts[category] ?? freqDiscounts.RESIDENTIAL ?? {};

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

  const airbnbDiscount =
    discountRow[draft.frequency] ??
    AIRBNB_FREQUENCIES.find((f) => f.value === draft.frequency)?.discount ??
    0;

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

      <Field label="Address" htmlFor="prop-addr">
        <Input
          id="prop-addr"
          value={draft.address}
          onChange={(e) => onChange({ address: e.target.value })}
          placeholder="123 rue Sainte-Catherine, Montréal"
        />
      </Field>

      <div className="cl-stack-12">
        <span className="cl-label">Service type</span>
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
      </div>

      {hasContent && (
        <div
          className="cl-stack-12"
          style={{
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

      {isPC ? (
        /* Post-construction: hours × cleaners estimate */
        <div className="cl-stack-12">
          <div className="cl-grid-2">
            <NumberStepper
              label="Estimated hours (4 hr min)"
              value={draft.pcHours}
              onChange={(v) => onChange({ pcHours: v })}
              min={4}
              max={24}
            />
            <NumberStepper
              label="Number of cleaners"
              value={draft.pcCleaners}
              onChange={(v) => onChange({ pcCleaners: v })}
              min={1}
              max={6}
            />
          </div>
          <div
            style={{
              background: "var(--primary-10)",
              borderRadius: 12,
              padding: "14px 18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}>
            <div>
              <div style={{ fontSize: 12, color: "var(--primary-60)", marginBottom: 2 }}>
                Estimate ({draft.pcHours} hour{draft.pcHours !== 1 ? "s" : ""})
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--primary)" }}>
                ${basePrice.toFixed(0)} <span style={{ fontSize: 13, fontWeight: 400, color: "var(--primary-60)" }}>before tax</span>
              </div>
            </div>
            <span style={{ fontSize: 11, color: "var(--primary-50)", maxWidth: 130, lineHeight: 1.4 }}>
              Final price confirmed after on-site assessment.
            </span>
          </div>
        </div>
      ) : (
        <>
        <div className="cl-grid-2">
          <NumberStepper
            label="Bedrooms"
            value={draft.bedCount}
            onChange={(v) => onChange({ bedCount: v })}
            min={0}
            max={8}
          />
          <NumberStepper
            label="Full bathrooms"
            value={draft.bathCount}
            onChange={(v) => onChange({ bathCount: v })}
            min={0}
            max={6}
          />
          <NumberStepper
            label="Half bathrooms"
            value={draft.halfBathCount}
            onChange={(v) => onChange({ halfBathCount: v })}
            min={0}
            max={4}
          />
          <Field label={isMoveInOut ? "Square footage (required)" : "Square footage"}>
            <Input
              value={draft.squareFootage || ""}
              onChange={(e) =>
                onChange({ squareFootage: parseInt(e.target.value) || 0 })
              }
              placeholder="e.g. 1200"
              inputMode="numeric"
            />
          </Field>
        </div>
        {isMoveInOut && (
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
        </>
      )}

      {!isPC && (
        <div className="cl-stack-12">
          <span className="cl-label">Frequency</span>
          {isAirbnb ? (
            <p style={{ fontSize: 12, color: "var(--primary-60)", margin: 0, lineHeight: 1.5 }}>
              Airbnb turnover discounts apply automatically when you book recurring cleans.
            </p>
          ) : (
            <p style={{ fontSize: 12, color: "var(--primary-60)", margin: 0, lineHeight: 1.5 }}>
              Recurring options auto-book future visits so you don&apos;t have to. You can change or cancel any visit before it happens.
            </p>
          )}
          <div className="cl-grid-2">
            {(isAirbnb ? AIRBNB_FREQUENCIES : FREQUENCIES).map((f) => {
              const pct = discountRow[f.value] ?? 0;
              // Airbnb discounts every visit; other services discount the 2nd+
              // visit (the first cleaning is always full price).
              const discountHint =
                f.value === "ONE_TIME" || pct <= 0
                  ? f.hint
                  : isAirbnb
                    ? `${pct}% off every visit`
                    : `${pct}% off from your 2nd visit`;
              return (
                <ChoiceButton
                  key={f.value}
                  active={draft.frequency === f.value}
                  title={f.label}
                  hint={discountHint}
                  onClick={() => onChange({ frequency: f.value })}
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
      )}

      <div className="cl-stack-12">
        <span className="cl-label">Add-ons</span>
        {(() => {
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
                {/* Icon cards (spec item 22) — tap the card to toggle. */}
                <div className="cl-addon-grid">
                  {items.map(({ a, idx }) => {
                    const Icon = addonIcon(a.name);
                    return (
                      <button
                        type="button"
                        key={a.id ?? `${a.name}-${idx}`}
                        className={`cl-addon-card ${a.selected ? "active" : ""}`}
                        aria-pressed={a.selected}
                        onClick={() => {
                          const next = [...draft.addOns];
                          next[idx] = { ...a, selected: !a.selected };
                          onChange({ addOns: next });
                        }}>
                        {a.selected && <span className="cl-addon-check">✓</span>}
                        <span className="cl-addon-ic">
                          <Icon size={20} />
                        </span>
                        <span className="cl-addon-card-name">{a.name}</span>
                        <span className="cl-addon-card-price">+${a.price.toFixed(2)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}
