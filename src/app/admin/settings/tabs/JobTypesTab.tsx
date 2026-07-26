"use client";

import { useState } from "react";
import { Plus, Trash2, Briefcase } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import { updateAppSetting } from "../../actions/updateAppSetting";
import Select from "@/components/ui/Select";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Feedback, Msg } from "./_shared";
import { SERVICE_CATEGORIES } from "@/lib/calendar-labels";
import {
  DEFAULT_SERVICE_CATALOG,
  SERVICE_CATALOG_KEY,
  inferCategoryFromName,
  normalizeServiceCatalog,
} from "@/lib/service-catalog";

interface JobTypesTabProps {
  settings: AppSettingRecord[];
}

interface JobTypeEntry {
  id: string;
  name: string;
  /**
   * Canonical category this service maps to. The NAME is what admins see and
   * can rename freely; the CATEGORY is what drives pricing, discounts,
   * checklists and calendar labels, and is what jobs actually store — so a
   * rename never orphans existing jobs (item 20).
   */
  category: string;
  isActive: boolean;
}

const KEY = SERVICE_CATALOG_KEY;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function JobTypesTab({ settings }: JobTypesTabProps) {
  // Normalized on read so a legacy list saved before categories existed
  // (name-only rows) still resolves to real services instead of vanishing.
  const initial = normalizeServiceCatalog(
    getSetting<unknown>(settings, KEY, DEFAULT_SERVICE_CATALOG)
  );

  const [items, setItems] = useState<JobTypeEntry[]>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  function update(id: string, patch: Partial<JobTypeEntry>) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
    );
  }

  function add() {
    // Default to the first category not already in use, so a new row can't
    // silently duplicate an existing service.
    const used = new Set(items.map((i) => i.category));
    const free =
      SERVICE_CATEGORIES.find((c) => !used.has(c.key))?.key ??
      SERVICE_CATEGORIES[0].key;
    setItems((prev) => [
      ...prev,
      { id: uid(), name: "", category: free, isActive: true },
    ]);
  }

  function remove(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    const cleaned = items
      .filter((i) => i.name.trim())
      .map((i) => ({
        ...i,
        name: i.name.trim(),
        // Belt and braces: a row left without an explicit category still gets
        // one inferred from its name rather than being dropped on read.
        category: i.category || inferCategoryFromName(i.name) || "RESIDENTIAL",
      }));

    // Two services mapping to the same category would put duplicate options in
    // every picker — the exact problem this item removes.
    const dupes = cleaned
      .map((i) => i.category)
      .filter((c, idx, arr) => arr.indexOf(c) !== idx);
    if (dupes.length > 0) {
      setMsg({
        type: "error",
        text: "Two job types map to the same service category. Give each row a different category.",
      });
      setSaving(false);
      return;
    }

    const res = await updateAppSetting({
      key: KEY,
      category: "jobTypes",
      value: cleaned,
    });
    if (res.success) {
      setItems(cleaned);
      setMsg({ type: "success", text: "Job types saved." });
    } else {
      setMsg({ type: "error", text: res.error || "Failed to save." });
    }
    setSaving(false);
  }

  return (
    <SectionCard
      title="Job Types"
      description="The single service list used by job creation, the job edit modal, filters, invoices and cleaner views. Renaming a job type here renames it everywhere; the category controls pricing, discounts and checklists."
      icon={Briefcase}
      actions={
        <Button
          type="button"
          variant="default"
          border={false}
          size="sm"
          onClick={add}
          className="rounded-xl">
          <Plus className="w-4 h-4 mr-1" /> Add Job Type
        </Button>
      }>
      <div className="space-y-2">
        {items.length === 0 && (
          <p className="text-sm text-[#008C9C]/60">No job types configured.</p>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 p-2 rounded-xl hover:bg-[#008C9C]/5 transition-colors">
            <Input
              variant="form"
              value={item.name}
              onChange={(e) => update(item.id, { name: e.target.value })}
              placeholder="Job type name"
              className="flex-1"
            />
            {/* The category is what the pricing engine, checklists and
                calendar labels key off. The name above is free to change. */}
            <Select
              value={item.category}
              onChange={(v) => update(item.id, { category: v })}
              size="sm"
              options={SERVICE_CATEGORIES.map((c) => ({
                value: c.key,
                label: c.label,
              }))}
              className="max-w-[210px]"
            />
            <label className="flex items-center gap-2 text-sm text-[#008C9C] select-none">
              <input
                type="checkbox"
                checked={item.isActive}
                onChange={(e) =>
                  update(item.id, { isActive: e.target.checked })
                }
                className="accent-[#008C9C]"
              />
              Active
            </label>
            <IconButton
              icon={Trash2}
              variant="ghost"
              size="sm"
              onClick={() => remove(item.id)}
              className="text-red-500"
            />
          </div>
        ))}
      </div>

      {msg && <Feedback msg={msg} />}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="action"
          border={false}
          onClick={handleSave}
          disabled={saving}
          className="rounded-xl px-6 py-2.5">
          {saving ? "Saving..." : "Save Job Types"}
        </Button>
      </div>
    </SectionCard>
  );
}
