"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";

interface PricingRulesTabProps {
  settings: AppSettingRecord[];
}

interface BaseTier {
  beds: number;
  baths: number;
  price: number;
}

interface AddOn {
  id: string;
  name: string;
  price: number;
}

interface PricingConfig {
  baseTiers: BaseTier[];
  addOns: AddOn[];
}

const KEY = "pricing.rules";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function PricingRulesTab({ settings }: PricingRulesTabProps) {
  const initial = getSetting<PricingConfig>(settings, KEY, {
    baseTiers: [
      { beds: 1, baths: 1, price: 120 },
      { beds: 2, baths: 1, price: 150 },
      { beds: 3, baths: 2, price: 200 },
    ],
    addOns: [
      { id: uid(), name: "Inside Fridge", price: 25 },
      { id: uid(), name: "Inside Oven", price: 30 },
    ],
  });

  const [baseTiers, setBaseTiers] = useState<BaseTier[]>(initial.baseTiers);
  const [addOns, setAddOns] = useState<AddOn[]>(initial.addOns);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  function updateTier(idx: number, patch: Partial<BaseTier>) {
    setBaseTiers((prev) =>
      prev.map((t, i) => (i === idx ? { ...t, ...patch } : t))
    );
  }

  function addTier() {
    setBaseTiers((prev) => [...prev, { beds: 1, baths: 1, price: 0 }]);
  }

  function removeTier(idx: number) {
    setBaseTiers((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateAddOn(id: string, patch: Partial<AddOn>) {
    setAddOns((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  function addAddOn() {
    setAddOns((prev) => [...prev, { id: uid(), name: "", price: 0 }]);
  }

  function removeAddOn(id: string) {
    setAddOns((prev) => prev.filter((a) => a.id !== id));
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    const res = await updateAppSetting({
      key: KEY,
      category: "pricing",
      value: { baseTiers, addOns },
    });
    if (res.success) setMsg({ type: "success", text: "Pricing rules saved." });
    else setMsg({ type: "error", text: res.error || "Failed to save." });
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title="Base Pricing Tiers"
        description="Set base prices by bedroom and bathroom count."
        actions={
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={addTier}>
            <Plus className="w-4 h-4 mr-1" /> Add Tier
          </Button>
        }>
        <div className="space-y-2">
          {baseTiers.length === 0 && (
            <p className="text-sm text-gray-500">No base tiers configured.</p>
          )}
          {baseTiers.map((tier, idx) => (
            <div
              key={idx}
              className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
              <Field label="Beds">
                <Input
                  type="number"
                  min="0"
                  value={tier.beds}
                  onChange={(e) =>
                    updateTier(idx, { beds: parseInt(e.target.value) || 0 })
                  }
                />
              </Field>
              <Field label="Baths">
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={tier.baths}
                  onChange={(e) =>
                    updateTier(idx, {
                      baths: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </Field>
              <Field label="Price ($)">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={tier.price}
                  onChange={(e) =>
                    updateTier(idx, {
                      price: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </Field>
              <IconButton
                icon={Trash2}
                variant="ghost"
                size="sm"
                onClick={() => removeTier(idx)}
                className="text-red-500"
              />
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Add-Ons"
        description="Optional services that can be added to a job."
        actions={
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={addAddOn}>
            <Plus className="w-4 h-4 mr-1" /> Add Add-On
          </Button>
        }>
        <div className="space-y-2">
          {addOns.length === 0 && (
            <p className="text-sm text-gray-500">No add-ons configured.</p>
          )}
          {addOns.map((addon) => (
            <div
              key={addon.id}
              className="grid grid-cols-[2fr_1fr_auto] gap-3 items-end">
              <Field label="Name">
                <Input
                  value={addon.name}
                  onChange={(e) =>
                    updateAddOn(addon.id, { name: e.target.value })
                  }
                  placeholder="e.g. Inside Fridge"
                />
              </Field>
              <Field label="Price ($)">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={addon.price}
                  onChange={(e) =>
                    updateAddOn(addon.id, {
                      price: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </Field>
              <IconButton
                icon={Trash2}
                variant="ghost"
                size="sm"
                onClick={() => removeAddOn(addon.id)}
                className="text-red-500"
              />
            </div>
          ))}
        </div>
      </SectionCard>

      {msg && <Feedback msg={msg} />}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="primary"
          onClick={handleSave}
          disabled={saving}>
          {saving ? "Saving..." : "Save Pricing Rules"}
        </Button>
      </div>
    </div>
  );
}
