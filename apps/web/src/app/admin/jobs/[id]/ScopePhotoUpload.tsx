"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader } from "lucide-react";

import { uploadJobPhoto } from "../../actions/uploadJobPhoto";

/**
 * Admin-side "areas to clean" photos (Sept 10, item 7).
 *
 * These are SCOPE photos, not proof photos: what needs attention, what must
 * not be missed, the stain by the back door. They are stored as the existing
 * `BEFORE` kind, so they need no schema change and they appear in the
 * cleaner's own gallery under the same "Before" heading every other surface
 * uses \u2014 which is the point, because the cleaner has to see them before
 * they start.
 *
 * `uploadJobPhoto` already admits an admin and already accepts a kind; what
 * was missing was any way for an admin to reach it.
 */
export default function ScopePhotoUpload({ jobId }: { jobId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setBusy(true);
    setError(null);

    // One at a time and sequential: each upload is a whole image, and firing
    // five at once is how a phone on site times out.
    for (const file of files) {
      const fd = new FormData();
      fd.set("jobId", jobId);
      fd.set("file", file);
      fd.set("kind", "BEFORE");
      fd.set("caption", "Area to clean");
      const res = await uploadJobPhoto(fd);
      if (!res.success) {
        setError(res.error ?? "That photo could not be uploaded.");
        break;
      }
    }

    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  return (
    <div style={{ marginTop: 4 }}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={onPick}
        disabled={busy}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          fontWeight: 600,
          color: "var(--primary-800, #005a63)",
          background: "transparent",
          border: "none",
          cursor: busy ? "default" : "pointer",
          padding: 0,
        }}>
        {busy ? <Loader size={14} className="animate-spin" /> : <ImagePlus size={14} />}
        {busy ? "Uploading\u2026" : "Add areas to clean"}
      </button>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--primary-50)" }}>
        Shown to the cleaner before they start, under Before.
      </p>
      {error && (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--error, #b91c1c)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
