"use client";

import { useState } from "react";
import { Plus, Trash2, Sparkles, BedDouble, Truck, HardHat, DollarSign, Repeat } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";
import {
  ADDON_POPUP_MESSAGE_MAX,
  ADDON_POPUP_TITLE_MAX,
  ROOM_TYPES,
  type AddOnCatalogEntry,
  type RoomType,
} from "@/lib/addon-catalog";
import { ADDON_ICONS, ADDON_ICON_KEYS } from "@/lib/addon-icons";
import {
  SERVICE_PRICING_KEY,
  ServicePricingConfig,
  normalizeServicePricing,
  DISCOUNTABLE_CATEGORIES,
  FREQ_DISCOUNT_KEYS,
} from "@/lib/service-pricing";
import {
  PC_DEPOSIT_DEFAULT_USD,
  PC_DEPOSIT_MAX_USD,
  PC_DEPOSIT_SETTING_KEY,
  STANDARD_BOOKING_DEPOSIT_USD,
  formatDeposit,
} from "@/lib/booking-deposit";

// Human labels for the discount grid.
const CATEGORY_LABELS: Record<string, string> = {
  RESIDENTIAL: "Residential",
  DEEP: "Deep",
  MOVE_IN_OUT: "Move-in/out",
  POST_CONSTRUCTION: "Post-construction",
  AIRBNB: "Airbnb",
  COMMERCIAL: "Commercial",
};
const FREQ_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Bi-weekly",
  TWICE_WEEKLY: "2×/week",
  HIGH_FREQUENCY: "Daily / 20+",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
};

interface PricingRulesTabProps {
  settings: AppSettingRecord[];
}

interface PerUnitRates {
  baseServicePrice: number;
  perBedroom: number;
  perFullBath: number;
  perHalfBath: number;
}

// The room enum and the add-on shape now live in @/lib/addon-catalog, which is
// also what validates them on read. They used to be declared here AND in
// getBookingConfig AND in book/types, and the three had already drifted on
// which fields were optional.
export type { RoomType };

const ROOM_LABELS: Record<RoomType, string> = {
  KITCHEN: "Kitchen",
  BATHROOM: "Bathroom",
  BEDROOM: "Bedroom",
  LIVING_ROOM: "Living room",
  LAUNDRY: "Laundry",
  OUTDOOR: "Outdoor / patio",
  WHOLE_HOME: "Whole home",
};

const ROOM_OPTIONS: { value: RoomType; label: string }[] = ROOM_TYPES.map((value) => ({
  value,
  label: ROOM_LABELS[value],
}));

/**
 * An add-on being EDITED. Looser than the stored shape: a half-filled row is
 * legal in the editor and only has to satisfy `normalizeAddOn` on read.
 */
type AddOn = Omit<AddOnCatalogEntry, "roomType" | "services"> & {
  roomType?: RoomType;
  /** Service types this add-on shows for. Empty/undefined = all services. */
  services?: string[];
};

// Service types must match the booking flow's SERVICE_TYPES values.
const SERVICE_OPTIONS: { value: string; label: string }[] = [
  { value: "STANDARD", label: "Standard" },
  { value: "DEEP", label: "Deep" },
  { value: "MOVE_IN_OUT", label: "Move-in/out" },
  { value: "POST_CONSTRUCTION", label: "Post-construction" },
  { value: "AIRBNB", label: "Airbnb" },
];

const PER_UNIT_KEY = "pricing.perUnit";
const ADDONS_KEY = "pricing.addOns";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function PricingRulesTab({ settings }: PricingRulesTabProps) {
  const initialRates = getSetting<PerUnitRates>(settings, PER_UNIT_KEY, {
    baseServicePrice: 100,
    perBedroom: 19,
    perFullBath: 19,
    perHalfBath: 10,
  });

  // Legacy key still used by add-ons fallback
  const legacyConfig = getSetting<{ addOns?: AddOn[] }>(settings, "pricing.rules", {});
  const initialAddOns = getSetting<AddOn[]>(
    settings,
    ADDONS_KEY,
    legacyConfig.addOns ?? [
      { id: uid(), name: "Inside Fridge", price: 25 },
      { id: uid(), name: "Inside Oven", price: 30 },
    ]
  );

  // Default baseServicePrice to 100 for settings saved before it existed.
  const [rates, setRates] = useState<PerUnitRates>({
    ...initialRates,
    baseServicePrice: initialRates.baseServicePrice ?? 100,
  });
  const [addOns, setAddOns] = useState<AddOn[]>(initialAddOns);
  const [svc, setSvc] = useState<ServicePricingConfig>(() =>
    normalizeServicePricing(getSetting<unknown>(settings, SERVICE_PRICING_KEY, {}))
  );
  // Post-construction deposit (Stage 11 / PDF #9). Lives beside the PC pricing
  // block because that is where an admin already goes to change what
  // post-construction costs — the deposit is the first number the customer pays,
  // not a payments-tab detail.
  const [pcDeposit, setPcDeposit] = useState<number>(() =>
    getSetting<number>(settings, PC_DEPOSIT_SETTING_KEY, PC_DEPOSIT_DEFAULT_USD)
  );
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  function updateMi(patch: Partial<ServicePricingConfig["moveInOut"]>) {
    setSvc((s) => ({ ...s, moveInOut: { ...s.moveInOut, ...patch } }));
  }
  function updatePc(patch: Partial<ServicePricingConfig["postConstruction"]>) {
    setSvc((s) => ({ ...s, postConstruction: { ...s.postConstruction, ...patch } }));
  }
  function updateFreqDiscount(cat: string, freq: string, value: number) {
    const clamped = Math.min(100, Math.max(0, value));
    setSvc((s) => ({
      ...s,
      frequencyDiscounts: {
        ...s.frequencyDiscounts,
        [cat]: { ...(s.frequencyDiscounts[cat] ?? {}), [freq]: clamped },
      },
    }));
  }

  function updateAddOn(id: string, patch: Partial<AddOn>) {
    setAddOns((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function addAddOn() {
    setAddOns((prev) => [...prev, { id: uid(), name: "", price: 0, roomType: "WHOLE_HOME" }]);
  }

  function removeAddOn(id: string) {
    setAddOns((prev) => prev.filter((a) => a.id !== id));
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);

    const [r1, r2, r3, r4] = await Promise.all([
      updateAppSetting({ key: PER_UNIT_KEY, category: "pricing", value: rates }),
      updateAppSetting({ key: ADDONS_KEY, category: "pricing", value: addOns }),
      updateAppSetting({ key: SERVICE_PRICING_KEY, category: "pricing", value: svc }),
      // Registry-governed and flagged `sensitive`, so this write is validated and
      // audit-logged by the settings spine rather than upserted raw. `category`
      // is ignored for a registered key — the registry's own ("bookings") wins.
      updateAppSetting({
        key: PC_DEPOSIT_SETTING_KEY,
        category: "bookings",
        value: pcDeposit,
      }),
    ]);

    if (r1.success && r2.success && r3.success && r4.success) {
      setMsg({ type: "success", text: "Pricing rules saved." });
    } else {
      setMsg({
        type: "error",
        text: r1.error ?? r2.error ?? r3.error ?? r4.error ?? "Failed to save.",
      });
    }
    setSaving(false);
  }

  const examplePrice =
    rates.baseServicePrice +
    2 * rates.perBedroom +
    1 * rates.perFullBath +
    0 * rates.perHalfBath;

  return (
    <div className="space-y-6">
      {/* Per-Unit Rates */}
      <SectionCard
        title="Per-Unit Pricing"
        description="Base price = base service price + (bedrooms × rate) + (full baths × rate) + (half baths × rate)."
        icon={BedDouble}>
        <div className="mb-4">
          <Field label="Base service price ($)">
            <Input
              variant="form"
              type="number"
              min="0"
              step="1"
              value={rates.baseServicePrice}
              onChange={(e) =>
                setRates((r) => ({
                  ...r,
                  baseServicePrice: parseFloat(e.target.value) || 0,
                }))
              }
            />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Per Bedroom ($)">
            <Input
              variant="form"
              type="number"
              min="0"
              step="1"
              value={rates.perBedroom}
              onChange={(e) =>
                setRates((r) => ({ ...r, perBedroom: parseFloat(e.target.value) || 0 }))
              }
            />
          </Field>
          <Field label="Per Full Bathroom ($)">
            <Input
              variant="form"
              type="number"
              min="0"
              step="1"
              value={rates.perFullBath}
              onChange={(e) =>
                setRates((r) => ({ ...r, perFullBath: parseFloat(e.target.value) || 0 }))
              }
            />
          </Field>
          <Field label="Per Half Bathroom ($)">
            <Input
              variant="form"
              type="number"
              min="0"
              step="1"
              value={rates.perHalfBath}
              onChange={(e) =>
                setRates((r) => ({ ...r, perHalfBath: parseFloat(e.target.value) || 0 }))
              }
            />
          </Field>
        </div>
        <p className="text-sm text-[#008C9C]/60 mt-3">
          Example: 2 bed + 1 full bath = <strong>${examplePrice.toFixed(2)}</strong>
        </p>
      </SectionCard>

      {/* Add-Ons */}
      <SectionCard
        title="Add-Ons"
        description="Optional services that can be added to a booking."
        icon={Sparkles}
        actions={
          <Button
            type="button"
            variant="default"
            border={false}
            size="sm"
            onClick={addAddOn}
            className="rounded-xl">
            <Plus className="w-4 h-4 mr-1" /> Add Add-On
          </Button>
        }>
        <div className="space-y-3">
          {addOns.length === 0 && (
            <p className="text-sm text-[#008C9C]/60">No add-ons configured.</p>
          )}
          {addOns.map((addon) => (
            <div key={addon.id} className="rounded-xl border border-[#008C9C]/10 p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1.4fr_auto] gap-3 items-end">
                <Field label="Name">
                  <Input
                    variant="form"
                    value={addon.name}
                    onChange={(e) => updateAddOn(addon.id, { name: e.target.value })}
                    placeholder="e.g. Inside Fridge"
                  />
                </Field>
                <Field label="Price ($)">
                  <Input
                    variant="form"
                    type="number"
                    min="0"
                    step="0.01"
                    value={addon.price}
                    onChange={(e) =>
                      updateAddOn(addon.id, { price: parseFloat(e.target.value) || 0 })
                    }
                  />
                </Field>
                <Field label="Room">
                  <select
                    value={addon.roomType ?? "WHOLE_HOME"}
                    onChange={(e) =>
                      updateAddOn(addon.id, { roomType: e.target.value as RoomType })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-[#008C9C]/15 bg-white text-[#003C46] text-sm focus:outline-none focus:border-[#008C9C] focus:ring-2 focus:ring-[#008C9C]/10">
                    {ROOM_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <IconButton
                  icon={Trash2}
                  variant="ghost"
                  size="sm"
                  onClick={() => removeAddOn(addon.id)}
                  className="text-red-500"
                />
              </div>

              {/* Icon (item 17). Without a stored key the icon is guessed from
                  the name, which misfires — "Chair cleaning" resolves to a vent
                  because of the "air" in it. Picking a key is the escape hatch;
                  "Auto" clears it and restores the guess. */}
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#008C9C]/60">
                  Icon
                </span>
                <div className="flex flex-wrap gap-1.5 mt-1.5 items-center">
                  <button
                    type="button"
                    onClick={() => updateAddOn(addon.id, { icon: undefined })}
                    className={`px-3 h-9 rounded-xl text-xs font-medium border transition-colors ${
                      !addon.icon
                        ? "bg-[#008C9C] text-white border-[#008C9C]"
                        : "bg-white text-[#008C9C]/70 border-[#008C9C]/15 hover:border-[#008C9C]/40"
                    }`}
                    title="Guess the icon from the add-on's name">
                    Auto
                  </button>
                  {ADDON_ICON_KEYS.map((key) => {
                    const Ic = ADDON_ICONS[key];
                    const on = addon.icon === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        title={key}
                        aria-label={`Use the ${key} icon`}
                        aria-pressed={on}
                        onClick={() => updateAddOn(addon.id, { icon: key })}
                        className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-colors ${
                          on
                            ? "bg-[#008C9C] text-white border-[#008C9C]"
                            : "bg-white text-[#008C9C]/70 border-[#008C9C]/15 hover:border-[#008C9C]/40"
                        }`}>
                        <Ic className="w-4 h-4" />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Customer pop-up (item 17) — shown when the customer SELECTS
                  this add-on during booking. */}
              <div className="rounded-xl bg-[#008C9C]/5 p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm text-[#003C46]">
                  <input
                    type="checkbox"
                    checked={!!addon.popupEnabled}
                    onChange={(e) =>
                      updateAddOn(addon.id, { popupEnabled: e.target.checked || undefined })
                    }
                    className="accent-[#008C9C]"
                  />
                  Show a message when a customer selects this
                </label>
                {addon.popupEnabled && (
                  <div className="space-y-2">
                    <Field label="Title">
                      <Input
                        variant="form"
                        value={addon.popupTitle ?? ""}
                        maxLength={ADDON_POPUP_TITLE_MAX}
                        onChange={(e) =>
                          updateAddOn(addon.id, { popupTitle: e.target.value || undefined })
                        }
                        placeholder={addon.name || "Defaults to the add-on's name"}
                      />
                    </Field>
                    <Field label="Message">
                      <textarea
                        rows={4}
                        value={addon.popupMessage ?? ""}
                        maxLength={ADDON_POPUP_MESSAGE_MAX}
                        onChange={(e) =>
                          updateAddOn(addon.id, { popupMessage: e.target.value || undefined })
                        }
                        placeholder="e.g. Couch cleaning is quoted per piece. We'll confirm the exact price before your visit."
                        className="w-full px-3 py-2 rounded-xl border border-[#008C9C]/15 bg-white text-[#003C46] text-sm focus:outline-none focus:border-[#008C9C] focus:ring-2 focus:ring-[#008C9C]/10"
                      />
                    </Field>
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-sm text-[#003C46]">
                        <input
                          type="checkbox"
                          checked={!!addon.popupRequestPhoto}
                          onChange={(e) =>
                            updateAddOn(addon.id, {
                              popupRequestPhoto: e.target.checked || undefined,
                            })
                          }
                          className="accent-[#008C9C]"
                        />
                        Tell them we&apos;ll ask for a photo
                      </label>
                      <span className="text-[11px] text-[#008C9C]/50">
                        {(addon.popupMessage ?? "").length}/{ADDON_POPUP_MESSAGE_MAX}
                      </span>
                    </div>
                    {!(addon.popupMessage ?? "").trim() && (
                      <p className="text-xs text-amber-700">
                        The pop-up is on but has no message — customers will see
                        just the title.
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[#008C9C]/60">
                  Shows for service
                </span>
                <div className="flex flex-wrap gap-2 mt-1.5 items-center">
                  {SERVICE_OPTIONS.map((s) => {
                    const on = (addon.services ?? []).includes(s.value);
                    return (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => {
                          const cur = addon.services ?? [];
                          const next = on ? cur.filter((v) => v !== s.value) : [...cur, s.value];
                          updateAddOn(addon.id, { services: next });
                        }}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          on
                            ? "bg-[#008C9C] text-white border-[#008C9C]"
                            : "bg-white text-[#008C9C]/70 border-[#008C9C]/15 hover:border-[#008C9C]/40"
                        }`}>
                        {s.label}
                      </button>
                    );
                  })}
                  {(!addon.services || addon.services.length === 0) && (
                    <span className="text-xs text-[#008C9C]/50">All services (none selected)</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Minimum job price — client-facing floor (item 9) */}
      <SectionCard
        title="Minimum job price"
        description="The lowest price a customer booking can be quoted. Admins can still price a job below this manually."
        icon={DollarSign}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Minimum ($)">
            <Input
              variant="form"
              type="number"
              min="0"
              step="1"
              value={svc.minJobPrice}
              onChange={(e) =>
                setSvc((s) => ({ ...s, minJobPrice: parseFloat(e.target.value) || 0 }))
              }
            />
          </Field>
        </div>
        <p className="text-sm text-[#008C9C]/60 mt-3">
          A booking that computes below <strong>${svc.minJobPrice.toFixed(2)}</strong> is
          charged this minimum. Applies to the customer booking page only.
        </p>
      </SectionCard>

      {/* Move-in / Move-out — priced per square foot */}
      <SectionCard
        title="Move-in / Move-out pricing"
        description="Charged per square foot, with a cheaper rate for larger homes."
        icon={Truck}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Large-home threshold (sq ft)">
            <Input
              variant="form"
              type="number"
              min="0"
              step="50"
              value={svc.moveInOut.thresholdSqft}
              onChange={(e) =>
                updateMi({ thresholdSqft: parseFloat(e.target.value) || 0 })
              }
            />
          </Field>
          <Field label="Rate at/above threshold ($/sq ft)">
            <Input
              variant="form"
              type="number"
              min="0"
              step="0.01"
              value={svc.moveInOut.rateAtOrAbove}
              onChange={(e) =>
                updateMi({ rateAtOrAbove: parseFloat(e.target.value) || 0 })
              }
            />
          </Field>
          <Field label="Rate below threshold ($/sq ft)">
            <Input
              variant="form"
              type="number"
              min="0"
              step="0.01"
              value={svc.moveInOut.rateBelow}
              onChange={(e) =>
                updateMi({ rateBelow: parseFloat(e.target.value) || 0 })
              }
            />
          </Field>
        </div>
        <p className="text-sm text-[#008C9C]/60 mt-3">
          Example: 1,200 sq ft ={" "}
          <strong>
            $
            {(
              1200 *
              (1200 >= svc.moveInOut.thresholdSqft
                ? svc.moveInOut.rateAtOrAbove
                : svc.moveInOut.rateBelow)
            ).toFixed(2)}
          </strong>{" "}
          · 800 sq ft ={" "}
          <strong>
            $
            {(
              800 *
              (800 >= svc.moveInOut.thresholdSqft
                ? svc.moveInOut.rateAtOrAbove
                : svc.moveInOut.rateBelow)
            ).toFixed(2)}
          </strong>
        </p>
      </SectionCard>

      {/* Post-construction — straight hourly, per cleaner, with a minimum */}
      <SectionCard
        title="Post-construction pricing"
        description="Charged per cleaner per hour, with a minimum number of billable hours."
        icon={HardHat}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Hourly rate ($/hr per cleaner)">
            <Input
              variant="form"
              type="number"
              min="0"
              step="1"
              value={svc.postConstruction.hourlyRate}
              onChange={(e) =>
                updatePc({ hourlyRate: parseFloat(e.target.value) || 0 })
              }
            />
          </Field>
          <Field label="Minimum hours">
            <Input
              variant="form"
              type="number"
              min="1"
              step="1"
              value={svc.postConstruction.minHours}
              onChange={(e) =>
                updatePc({ minHours: parseFloat(e.target.value) || 0 })
              }
            />
          </Field>
        </div>
        {/* Stage 11 / PDF #9 — the deposit charged before a post-construction
            request can be submitted. Its own row, below the rate/minimum grid,
            because it is a different KIND of number: the rate prices the job, this
            is what the customer's card is charged up front and credited back
            against the final quote. */}
        <div className="mt-4 pt-4 border-t border-[#008C9C]/10">
          <Field label="Deposit charged at booking ($)">
            <Input
              variant="form"
              type="number"
              min="0"
              max={String(PC_DEPOSIT_MAX_USD)}
              step="10"
              value={pcDeposit}
              onChange={(e) => setPcDeposit(parseFloat(e.target.value) || 0)}
            />
          </Field>
          <p className="text-sm text-[#008C9C]/60 mt-2">
            Charged when the customer submits a post-construction request, before
            anyone has seen the space, and credited against the final quote. Every
            other service keeps its{" "}
            {formatDeposit(STANDARD_BOOKING_DEPOSIT_USD)} deposit. Changing this
            affects NEW requests only — existing bookings keep the deposit they
            actually charged.
          </p>
        </div>
        <p className="text-sm text-[#008C9C]/60 mt-3">
          {svc.postConstruction.minHours}h × 1 cleaner ={" "}
          <strong>
            ${(svc.postConstruction.minHours * svc.postConstruction.hourlyRate).toFixed(2)}
          </strong>{" "}
          · 6h × 2 cleaners ={" "}
          <strong>
            ${(6 * svc.postConstruction.hourlyRate * 2).toFixed(2)}
          </strong>{" "}
          · anything under {svc.postConstruction.minHours}h bills at {svc.postConstruction.minHours}h
        </p>
      </SectionCard>

      {/* Recurring frequency discounts — per service category (item 7) */}
      <SectionCard
        title="Recurring discounts"
        description="Discount applied to the 2nd and later cleanings of a recurring booking (the first cleaning is always full price). Set a cell to 0 for no discount. Configurable per service category."
        icon={Repeat}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="text-left font-medium text-[#008C9C] py-2 pr-3 whitespace-nowrap">
                  Service
                </th>
                {FREQ_DISCOUNT_KEYS.map((f) => (
                  <th
                    key={f}
                    className="text-center font-medium text-[#008C9C]/70 py-2 px-1 whitespace-nowrap">
                    {FREQ_LABELS[f] ?? f}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DISCOUNTABLE_CATEGORIES.map((cat) => (
                <tr key={cat} className="border-t border-[#008C9C]/10">
                  <td className="py-2 pr-3 font-medium text-[#0F172A] whitespace-nowrap">
                    {CATEGORY_LABELS[cat] ?? cat}
                  </td>
                  {FREQ_DISCOUNT_KEYS.map((f) => (
                    <td key={f} className="py-1 px-1">
                      <div className="relative">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          value={svc.frequencyDiscounts[cat]?.[f] ?? 0}
                          onChange={(e) =>
                            updateFreqDiscount(cat, f, parseFloat(e.target.value) || 0)
                          }
                          className="w-16 rounded-lg border border-[#008C9C]/20 bg-white py-1.5 pl-2 pr-5 text-right text-[#0F172A] focus:border-[#008C9C] focus:outline-none"
                        />
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[#008C9C]/50">
                          %
                        </span>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-[#008C9C]/60 mt-3">
          Airbnb turnovers apply the discount to every visit; all other services
          apply it from the 2nd cleaning onward.
        </p>
      </SectionCard>

      {msg && <Feedback msg={msg} />}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="action"
          border={false}
          onClick={handleSave}
          disabled={saving}
          className="rounded-xl px-6 py-2.5">
          {saving ? "Saving..." : "Save Pricing Rules"}
        </Button>
      </div>
    </div>
  );
}
