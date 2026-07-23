"use client";

import { useRef, useState } from "react";
import { FileText, ImagePlus, Loader2, Trash2 } from "lucide-react";
import Button from "@/components/ui/Button";
import { updateAppSetting } from "../../actions/updateAppSetting";
import { uploadServiceContentImage } from "../../actions/uploadServiceContentImage";
import { AppSettingRecord, getSetting } from "../types";
import { SectionCard, Field, Feedback, Msg } from "./_shared";
import {
  SERVICE_CONTENT_KEY,
  ServiceContentConfig,
  normalizeServiceContent,
} from "@/lib/service-content";

interface ServiceContentTabProps {
  settings: AppSettingRecord[];
}

// Labels mirror the booking flow's SERVICE_TYPES (book/types.ts).
const SERVICE_LABELS: { value: string; label: string }[] = [
  { value: "STANDARD", label: "Standard cleaning" },
  { value: "DEEP", label: "Deep cleaning" },
  { value: "MOVE_IN_OUT", label: "Move-in / move-out" },
  { value: "POST_CONSTRUCTION", label: "Post-construction" },
  { value: "AIRBNB", label: "Airbnb turnover" },
];

export default function ServiceContentTab({ settings }: ServiceContentTabProps) {
  const [content, setContent] = useState<ServiceContentConfig>(() =>
    normalizeServiceContent(getSetting<unknown>(settings, SERVICE_CONTENT_KEY, {}))
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  function update(service: string, patch: Partial<{ text: string; imageUrl: string }>) {
    setContent((c) => ({
      ...c,
      [service]: { ...(c[service] ?? { text: "", imageUrl: "" }), ...patch },
    }));
  }

  async function handleUpload(service: string, file: File) {
    setUploading(service);
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await uploadServiceContentImage(fd);
    if (res.success) {
      update(service, { imageUrl: res.url });
    } else {
      setMsg({ type: "error", text: res.error });
    }
    setUploading(null);
  }

  async function handleSave() {
    setSaving(true);
    setMsg(null);
    const res = await updateAppSetting({
      key: SERVICE_CONTENT_KEY,
      category: "content",
      value: content,
    });
    setMsg(
      res.success
        ? { type: "success", text: "What's included saved." }
        : { type: "error", text: res.error ?? "Failed to save." }
    );
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      {SERVICE_LABELS.map((s) => {
        const entry = content[s.value] ?? { text: "", imageUrl: "" };
        return (
          <SectionCard key={s.value} title={s.label} icon={FileText}>
            <Field
              label="What's included"
              hint="Shown to customers on the booking page when they pick this service. Leave blank to hide the panel.">
              <textarea
                rows={5}
                value={entry.text}
                onChange={(e) => update(s.value, { text: e.target.value })}
                placeholder={`e.g. A ${s.label.toLowerCase()} covers all bedrooms, bathrooms, the kitchen and common areas — dusting, vacuuming, mopping, and sanitising surfaces.`}
                className="w-full px-4 py-2.5 rounded-xl border border-transparent bg-[#008C9C]/5 text-sm text-[#008C9C] placeholder:text-[#008C9C]/40 focus:outline-none focus:ring-2 focus:ring-[#008C9C]/20"
              />
            </Field>

            <Field label="Graphic (optional)" hint="JPG, PNG, GIF, WebP or HEIC, up to 10MB.">
              <ImagePicker
                imageUrl={entry.imageUrl}
                uploading={uploading === s.value}
                onPick={(file) => handleUpload(s.value, file)}
                onRemove={() => update(s.value, { imageUrl: "" })}
              />
            </Field>
          </SectionCard>
        );
      })}

      {msg && <Feedback msg={msg} />}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="action"
          border={false}
          onClick={handleSave}
          disabled={saving}
          className="rounded-xl px-6 py-2.5">
          {saving ? "Saving..." : "Save What's Included"}
        </Button>
      </div>
    </div>
  );
}

function ImagePicker({
  imageUrl,
  uploading,
  onPick,
  onRemove,
}: {
  imageUrl: string;
  uploading: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  if (imageUrl) {
    return (
      <div className="flex items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Service graphic"
          className="w-40 h-28 object-cover rounded-xl border border-[#008C9C]/15"
        />
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1.5 text-sm text-[#dc2626] hover:underline">
          <Trash2 className="w-4 h-4" />
          Remove
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-[#008C9C]/30 bg-[#008C9C]/5 text-sm text-[#008C9C] hover:bg-[#008C9C]/10 disabled:opacity-60">
        {uploading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <ImagePlus className="w-4 h-4" />
        )}
        {uploading ? "Uploading..." : "Upload graphic"}
      </button>
    </div>
  );
}
