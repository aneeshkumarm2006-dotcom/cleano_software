"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Feedback, Msg } from "./_shared";

interface JobTypesTabProps {
  settings: AppSettingRecord[];
}

interface JobTypeEntry {
  id: string;
  name: string;
  isActive: boolean;
}

const KEY = "jobTypes.list";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function JobTypesTab({ settings }: JobTypesTabProps) {
  const initial = getSetting<JobTypeEntry[]>(settings, KEY, [
    { id: uid(), name: "Standard Cleaning", isActive: true },
    { id: uid(), name: "Deep Cleaning", isActive: true },
    { id: uid(), name: "Move-In/Out", isActive: true },
    { id: uid(), name: "Post-Construction", isActive: true },
  ]);

  const [items, setItems] = useState<JobTypeEntry[]>(initial);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  function update(id: string, patch: Partial<JobTypeEntry>) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
    );
  }

  function add() {
    setItems((prev) => [...prev, { id: uid(), name: "", isActive: true }]);
  }

  function remove(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    const cleaned = items.filter((i) => i.name.trim());
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
      description="Manage selectable job types and their availability."
      actions={
        <Button type="button" variant="default" size="sm" onClick={add}>
          <Plus className="w-4 h-4 mr-1" /> Add Job Type
        </Button>
      }>
      <div className="space-y-2">
        {items.length === 0 && (
          <p className="text-sm text-gray-500">No job types configured.</p>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50">
            <Input
              value={item.name}
              onChange={(e) => update(item.id, { name: e.target.value })}
              placeholder="Job type name"
              className="flex-1"
            />
            <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
              <input
                type="checkbox"
                checked={item.isActive}
                onChange={(e) =>
                  update(item.id, { isActive: e.target.checked })
                }
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
          variant="primary"
          onClick={handleSave}
          disabled={saving}>
          {saving ? "Saving..." : "Save Job Types"}
        </Button>
      </div>
    </SectionCard>
  );
}
