"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import imageCompression from "browser-image-compression";
import { Camera, ImagePlus, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/customer/Field";
import { uploadBookingPhoto } from "../../actions/uploadBookingPhoto";
import type { BookingPhoto } from "../types";
import {
  BOOKING_PHOTO_MAX,
  BOOKING_PHOTO_MAX_BYTES,
  BOOKING_PHOTO_MIN,
} from "@/lib/booking-deposit";

/**
 * Photos of the space, collected during booking (PDF #9, Stage 11).
 *
 * ## Why this is not `cleaners/.../PhotoUpload.tsx`
 *
 * That component is Tailwind admin/cleaner chrome, requires a jobId, and asks the
 * uploader to press "Upload N photos" when they're done. None of the three fits
 * here: the booking flow is the customer-styled `cl-*` design system, the job
 * does not exist yet, and a customer mid-wizard will walk past a second button
 * and then be blocked by a Continue gate they can't explain.
 *
 * So uploads fire on drop. By the time the customer reaches step 5 the photos are
 * already in storage and the draft holds URLs — which is also what lets a
 * restored draft keep them (a `File` cannot survive sessionStorage, a URL can).
 *
 * ## What the parent owns
 *
 * `value` / `onChange` are the URLs, and they are the ONLY state that leaves this
 * component. Compression progress, per-file errors and previews are local: a
 * half-uploaded photo must not reach the draft, because the step gate counts
 * `value.length` and would otherwise let a customer continue on a photo that
 * never landed.
 */

const TARGET_MAX_SIZE_MB = 1;
const COMPRESSION_THRESHOLD = 1 * 1024 * 1024;

const ACCEPTED_TYPES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
  "image/webp": [".webp"],
};

type Row = {
  id: string;
  preview: string;
  name: string;
  status: "preparing" | "uploading" | "done" | "error";
  error?: string;
  /** Set once the upload lands — the link between a row and the parent's value. */
  url?: string;
};

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Shrink anything over 1 MB before it crosses the wire. A phone photo is
 * routinely 4–8 MB and a post-construction booking wants up to ten of them, on
 * whatever connection the customer is standing on.
 *
 * Falls back to the ORIGINAL file on any failure rather than refusing the photo —
 * the server's 10 MB ceiling is the real limit, and it is checked there.
 */
async function compressIfNeeded(file: File): Promise<File> {
  if (file.size <= COMPRESSION_THRESHOLD) return file;
  try {
    const out = await imageCompression(file, {
      maxSizeMB: TARGET_MAX_SIZE_MB,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      initialQuality: 0.75,
      alwaysKeepResolution: false,
      fileType: file.type === "image/png" ? "image/jpeg" : undefined,
    });
    if (out.size >= file.size) return file;
    return new File(
      [out],
      file.name.replace(/\.[^.]+$/, "") + (out.type === "image/jpeg" ? ".jpg" : ""),
      { type: out.type }
    );
  } catch (err) {
    console.error("Booking photo compression failed, sending original:", err);
    return file;
  }
}

interface Props {
  value: BookingPhoto[];
  onChange: (photos: BookingPhoto[]) => void;
  /** True when the booking cannot proceed without the minimum — post-construction. */
  required?: boolean;
}

export default function BookingPhotoUpload({
  value,
  onChange,
  required = false,
}: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  // Object URLs are revoked on unmount, not per-row: the preview has to outlive
  // the upload (it IS the thumbnail once the photo has landed), so the only safe
  // moment to release them is when the component goes away.
  const previewsRef = useRef<string[]>([]);
  useEffect(
    () => () => {
      previewsRef.current.forEach((u) => URL.revokeObjectURL(u));
    },
    []
  );

  // A draft restored from sessionStorage arrives with URLs but no rows — its
  // object-URL previews died with the tab. Rebuild thumbnails from the stored
  // Cloudinary URLs so the customer sees what they already uploaded rather than
  // an empty dropzone above a "2 photos added" count.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (value.length === 0) return;
    setRows(
      value.map((p) => ({
        id: p.publicId || genId(),
        preview: p.url,
        name: "Uploaded photo",
        status: "done" as const,
        url: p.url,
      }))
    );
    // Runs once on mount; `value` is read, not tracked, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadedCount = value.length;
  const slotsLeft = Math.max(0, BOOKING_PHOTO_MAX - rows.length);

  const accept = useCallback(
    async (incoming: File[]) => {
      setNotice(null);
      if (incoming.length === 0) return;

      if (slotsLeft <= 0) {
        setNotice(`You can add up to ${BOOKING_PHOTO_MAX} photos.`);
        return;
      }
      const files = incoming.slice(0, slotsLeft);
      if (files.length < incoming.length) {
        setNotice(
          `Added ${files.length} of ${incoming.length} — ${BOOKING_PHOTO_MAX} photos is the limit.`
        );
      }

      const placeholders: Row[] = files.map((f) => {
        const preview = URL.createObjectURL(f);
        previewsRef.current.push(preview);
        return {
          id: genId(),
          preview,
          name: f.name,
          status: "preparing" as const,
        };
      });
      setRows((prev) => [...prev, ...placeholders]);

      // Accumulated locally and handed up whole on each success. Reading `value`
      // again inside the loop would read the render this callback closed over, so
      // two photos uploading back to back would keep only the second.
      const committed = [...value];

      // Sequential, not parallel: several 8 MB phone photos compressing and
      // uploading at once is how a mid-range phone runs out of memory, and the
      // per-IP rate limit on the action counts requests either way.
      for (let i = 0; i < files.length; i++) {
        const row = placeholders[i];
        const patch = (p: Partial<Row>) =>
          setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...p } : r)));

        try {
          const prepared = await compressIfNeeded(files[i]);
          if (prepared.size > BOOKING_PHOTO_MAX_BYTES) {
            patch({
              status: "error",
              error: "Still too large after compression. Try a smaller photo.",
            });
            continue;
          }
          patch({ status: "uploading" });

          const fd = new FormData();
          fd.append("file", prepared);
          const res = await uploadBookingPhoto(fd);

          if (!res.success) {
            patch({ status: "error", error: res.error });
            continue;
          }
          patch({ status: "done", url: res.url });
          committed.push({ url: res.url, publicId: res.publicId });
          onChange([...committed]);
        } catch (err) {
          console.error("Booking photo upload failed", err);
          patch({ status: "error", error: "That photo didn't upload. Try again." });
        }
      }
    },
    [slotsLeft, onChange, value]
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: (files: File[]) => void accept(files),
    accept: ACCEPTED_TYPES,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    disabled: slotsLeft === 0,
  });

  function remove(id: string) {
    const row = rows.find((r) => r.id === id);
    setRows((prev) => prev.filter((r) => r.id !== id));
    // The stored asset is deliberately left in place. Deleting it would need a
    // second public endpoint that takes a public id — an obvious lever for
    // deleting somebody else's photo — and an orphan in an upload folder is a
    // cheaper problem than that. The job only ever gets the URLs still listed here.
    if (row?.url) onChange(value.filter((p) => p.url !== row.url));
    setNotice(null);
  }

  const busy = rows.some((r) => r.status === "preparing" || r.status === "uploading");
  const short = required && uploadedCount < BOOKING_PHOTO_MIN;

  return (
    <div className="cl-stack-12">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) {
            void accept(Array.from(e.target.files));
            e.target.value = "";
          }
        }}
      />

      <div
        {...getRootProps()}
        style={{
          border: `2px dashed ${
            isDragActive ? "var(--primary)" : "var(--primary-20, rgba(0,66,74,.2))"
          }`,
          borderRadius: 16,
          padding: "22px 18px",
          textAlign: "center",
          background: isDragActive ? "var(--primary-10)" : "transparent",
          transition: "background .15s, border-color .15s",
          opacity: slotsLeft === 0 ? 0.6 : 1,
        }}>
        <input {...getInputProps()} />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}>
          <span
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "var(--primary-10)",
              color: "var(--primary)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
            <ImagePlus size={20} />
          </span>
          <p style={{ margin: 0, fontSize: 14, color: "var(--ink)" }}>
            {isDragActive ? "Drop your photos here" : "Add photos of the space"}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--primary-60)" }}>
            {uploadedCount} of {BOOKING_PHOTO_MAX} added · large photos are shrunk
            automatically
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap", justifyContent: "center" }}>
            <Button
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                open();
              }}
              disabled={slotsLeft === 0}>
              <Upload size={14} /> Choose photos
            </Button>
            <Button
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                if (slotsLeft > 0) cameraInputRef.current?.click();
              }}
              disabled={slotsLeft === 0}>
              <Camera size={14} /> Take a photo
            </Button>
          </div>
        </div>
      </div>

      {rows.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
            gap: 10,
          }}>
          {rows.map((r) => (
            <div
              key={r.id}
              style={{
                position: "relative",
                aspectRatio: "1 / 1",
                borderRadius: 12,
                overflow: "hidden",
                border:
                  r.status === "error"
                    ? "1px solid var(--error-text, #dc2626)"
                    : "1px solid var(--primary-10)",
                background: "var(--primary-10)",
              }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={r.preview}
                alt={r.name}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              {(r.status === "preparing" || r.status === "uploading") && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(0,0,0,.45)",
                    color: "#fff",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 4,
                    fontSize: 10,
                  }}>
                  <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
                  {r.status === "preparing" ? "Shrinking…" : "Uploading…"}
                </div>
              )}
              {r.status !== "preparing" && r.status !== "uploading" && (
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  aria-label={`Remove ${r.name}`}
                  style={{
                    position: "absolute",
                    top: 5,
                    right: 5,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: "none",
                    background: "rgba(0,0,0,.6)",
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}>
                  <X size={12} />
                </button>
              )}
              {r.status === "error" && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    padding: "4px 6px",
                    background: "rgba(220,38,38,.9)",
                    color: "#fff",
                    fontSize: 9.5,
                    lineHeight: 1.25,
                  }}>
                  {r.error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {notice && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--primary-70)" }}>{notice}</p>
      )}

      {short && !busy && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--error-text, #dc2626)" }}>
          Please add at least {BOOKING_PHOTO_MIN} photos so we can quote the job
          accurately.
        </p>
      )}
    </div>
  );
}
