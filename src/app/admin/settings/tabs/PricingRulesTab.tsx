"use client";

import { useState } from "react";
import { Plus, Trash2, Sparkles, BedDouble, Truck, HardHat, DollarSign } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";
import {
  SERVICE_PRICING_KEY,
  ServicePricingConfig,
  normalizeServicePricing,
} from "@/lib/service-pricing";

interface PricingRulesTabProps {
  settings: AppSettingRecord[];
}

interface PerUnitRates {
  baseServicePrice: number;
  perBedroom: number;
  perFullBath: number;
  perHalfBath: number;
}

export type RoomType =
  | "KITCHEN"
  | "BATHROOM"
  | "BEDROOM"
  | "LIVING_ROOM"
  | "LAUNDRY"
  | "OUTDOOR"
  | "WHOLE_HOME";

const ROOM_OPTIONS: { value: RoomType; label: string }[] = [
  { value: "KITCHEN", label: "Kitchen" },
  { value: "BATHROOM", label: "Bathroom" },
  { value: "BEDROOM", label: "Bedroom" },
  { value: "LIVING_ROOM", label: "Living room" },
  { value: "LAUNDRY", label: "Laundry" },
  { value: "OUTDOOR", label: "Outdoor / patio" },
  { value: "WHOLE_HOME", label: "Whole home" },
];

interface AddOn {
  id: string;
  name: string;
  price: number;
  roomType?: RoomType;
  /** Service types this add-on shows for. Empty/undefined = all services. */
  services?: string[];
}

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
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  function updateMi(patch: Partial<ServicePricingConfig["moveInOut"]>) {
    setSvc((s) => ({ ...s, moveInOut: { ...s.moveInOut, ...patch } }));
  }
  function updatePc(patch: Partial<ServicePricingConfig["postConstruction"]>) {
    setSvc((s) => ({ ...s, postConstruction: { ...s.postConstruction, ...patch } }));
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

    const [r1, r2, r3] = await Promise.all([
      updateAppSetting({ key: PER_UNIT_KEY, category: "pricing", value: rates }),
      updateAppSetting({ key: ADDONS_KEY, category: "pricing", value: addOns }),
      updateAppSetting({ key: SERVICE_PRICING_KEY, category: "pricing", value: svc }),
    ]);

    if (r1.success && r2.success && r3.success) {
      setMsg({ type: "success", text: "Pricing rules saved." });
    } else {
      setMsg({
        type: "error",
        text: r1.error ?? r2.error ?? r3.error ?? "Failed to save.",
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
                    <span className="text-xs text-[#008C9C]/50 italic">All services (none selected)</span>
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
