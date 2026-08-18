"use client";

/**
 * The cleaner's job-photo uploader (new photo/address fixes, item 1).
 *
 * Three things changed here, all from the handoff:
 *
 *   1. The 20-photo cap is gone. `MAX_PHOTOS_PER_JOB` (200) is the ceiling now,
 *      it lives in @/lib/job-photos beside the server's copy of the same rule
 *      rather than being retyped here, and it is printed on the dropzone BEFORE
 *      any file is picked — "clearly shown before upload".
 *   2. Every photo is FILED: before / after / issue / general. The picker above
 *      the dropzone sets the type for the batch you are about to add; each
 *      queued card can override it, because a cleaner photographing a room they
 *      just finished and the broken blind in it is doing both at once.
 *   3. A failed upload no longer loses the batch. Failures stay in the queue
 *      with their error, the banner says exactly how many failed, and "Retry
 *      failed" re-sends only those — the photos that landed are already saved
 *      and are never re-uploaded.
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import imageCompression from "browser-image-compression";
import { Camera, Upload, X, Loader, ImagePlus, RotateCw } from "lucide-react";
import Button from "@/components/ui/Button";
import { uploadJobPhoto } from "@/app/admin/actions/uploadJobPhoto";
import {
  DEFAULT_JOB_PHOTO_KIND,
  JOB_PHOTO_KINDS,
  JOB_PHOTO_KIND_HINT,
  JOB_PHOTO_KIND_LABEL,
  MAX_PHOTOS_PER_JOB,
  type JobPhotoKind,
} from "@/lib/job-photos";

const TARGET_MAX_SIZE_MB = 1;
const HARD_MAX_SIZE = 10 * 1024 * 1024;
const COMPRESSION_THRESHOLD = 1 * 1024 * 1024;

/**
 * How many uploads are in flight at once.
 *
 * This used to be 1 — a strict `for … await` — which was fine for a 20-photo
 * ceiling and is not fine for a 60-photo post-construction job on hotel wifi.
 * It is not unbounded either: each request carries a whole image, and a phone
 * that opens 60 sockets at once gets slower, not faster, and is likelier to
 * have the OS kill the tab. Three is enough to hide per-request latency.
 */
const UPLOAD_CONCURRENCY = 3;

const ACCEPTED_TYPES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
  "image/webp": [".webp"],
};

type PendingPhoto = {
  id: string;
  file: File;
  originalSize: number;
  compressed: boolean;
  preview: string;
  caption: string;
  kind: JobPhotoKind;
  status: "preparing" | "pending" | "uploading" | "success" | "error";
  error?: string;
};

interface PhotoUploadProps {
  jobId: string;
  currentPhotoCount: number;
  onUploaded?: () => void;
}

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function compressIfNeeded(file: File): Promise<{
  file: File;
  compressed: boolean;
}> {
  if (file.size <= COMPRESSION_THRESHOLD) {
    return { file, compressed: false };
  }
  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: TARGET_MAX_SIZE_MB,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      initialQuality: 0.75,
      alwaysKeepResolution: false,
      fileType: file.type === "image/png" ? "image/jpeg" : undefined,
    });
    if (compressed.size >= file.size) {
      return { file, compressed: false };
    }
    const renamed = new File(
      [compressed],
      file.name.replace(/\.[^.]+$/, "") +
        (compressed.type === "image/jpeg" ? ".jpg" : ""),
      { type: compressed.type }
    );
    return { file: renamed, compressed: true };
  } catch (err) {
    console.error("Compression failed, using original:", err);
    return { file, compressed: false };
  }
}

/**
 * Run `worker` over every item with at most `limit` in flight.
 *
 * Deliberately not `Promise.all(files.map(...))`: that is unbounded, and
 * deliberately not a plain sequential loop, which is what this replaced. Each
 * worker reports its own result through `setPending`, so a rejection cannot
 * take the batch down — there is nothing to settle here.
 */
async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        await worker(item);
      }
    })()
  );
  await Promise.all(runners);
}

export default function PhotoUpload({
  jobId,
  currentPhotoCount,
  onUploaded,
}: PhotoUploadProps) {
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  /** How many of the last run failed — drives the retry banner. */
  const [failedCount, setFailedCount] = useState(0);
  /** The type new photos are filed under. Sticky across batches on purpose:
   *  a cleaner shooting ten "before" photos sets it once. */
  const [kind, setKind] = useState<JobPhotoKind>(DEFAULT_JOB_PHOTO_KIND);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const remainingSlots = Math.max(0, MAX_PHOTOS_PER_JOB - currentPhotoCount);

  const acceptFiles = useCallback(
    async (incoming: File[]) => {
      setGlobalError(null);
      if (incoming.length === 0) return;

      const availableSlots = remainingSlots - pending.length;
      if (availableSlots <= 0) {
        setGlobalError(
          `This job is at the ${MAX_PHOTOS_PER_JOB}-photo maximum. Upload or remove what is queued before adding more.`
        );
        return;
      }

      const accepted = incoming.slice(0, availableSlots);
      if (accepted.length < incoming.length) {
        setGlobalError(
          `Added ${accepted.length} of ${incoming.length} — that reaches the ${MAX_PHOTOS_PER_JOB}-photo maximum for this job.`
        );
      }

      const placeholders: PendingPhoto[] = accepted.map((file) => ({
        id: genId(),
        file,
        originalSize: file.size,
        compressed: false,
        preview: URL.createObjectURL(file),
        caption: "",
        kind,
        status: "preparing",
      }));

      setPending((prev) => [...prev, ...placeholders]);

      // Compression is CPU-bound and already runs in a worker; keeping it
      // sequential stops a 40-photo drop from freezing the phone.
      for (const placeholder of placeholders) {
        try {
          const { file: processed, compressed } = await compressIfNeeded(
            placeholder.file
          );

          if (processed.size > HARD_MAX_SIZE) {
            setPending((prev) =>
              prev.map((p) =>
                p.id === placeholder.id
                  ? {
                      ...p,
                      status: "error",
                      error:
                        "Image too large even after compression (>10MB). Try a smaller photo.",
                    }
                  : p
              )
            );
            continue;
          }

          const newPreview = URL.createObjectURL(processed);
          setPending((prev) =>
            prev.map((p) => {
              if (p.id !== placeholder.id) return p;
              URL.revokeObjectURL(p.preview);
              return {
                ...p,
                file: processed,
                compressed,
                preview: newPreview,
                status: "pending",
              };
            })
          );
        } catch {
          setPending((prev) =>
            prev.map((p) =>
              p.id === placeholder.id
                ? {
                    ...p,
                    status: "error",
                    error: "Failed to prepare image",
                  }
                : p
            )
          );
        }
      }
    },
    [pending.length, remainingSlots, kind]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      void acceptFiles(acceptedFiles);
    },
    [acceptFiles]
  );

  /**
   * Say so when the picker throws a file away.
   *
   * `useDropzone`'s `accept` filter runs BEFORE `onDrop`, so a file of the
   * wrong type never becomes a queue row — it simply is not there. Without this
   * handler a cleaner who selects ten photos and gets nine sees no error, no
   * failed card and no explanation: the tenth is gone, and the batch looks like
   * it succeeded. That is the one failure the handoff's "show which photos
   * failed" bullet cannot cover by itself, because there is nothing left to
   * show — which is exactly why it has to be reported here instead.
   *
   * Named, not counted: "1 photo was skipped" sends someone hunting through a
   * camera roll. The filename and the reason let them convert the file or pick
   * a different one.
   */
  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    if (rejections.length === 0) return;
    const names = rejections.map((r) => r.file.name);
    const shown = names.slice(0, 3).join(", ");
    const more = names.length > 3 ? ` and ${names.length - 3} more` : "";
    setGlobalError(
      `Skipped ${names.length} file${names.length === 1 ? "" : "s"} (${shown}${more}) — ` +
        `not a supported photo. Use JPG, PNG, HEIC or WebP. Everything else was added.`
    );
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    onDropRejected,
    accept: ACCEPTED_TYPES,
    multiple: true,
    noClick: true,
    noKeyboard: true,
    disabled: uploading || remainingSlots === 0,
  });

  const openCamera = useCallback(() => {
    if (uploading || remainingSlots === 0) return;
    cameraInputRef.current?.click();
  }, [uploading, remainingSlots]);

  const handleCaptionChange = (id: string, value: string) => {
    setPending((prev) =>
      prev.map((p) => (p.id === id ? { ...p, caption: value } : p))
    );
  };

  const handleKindChange = (id: string, value: JobPhotoKind) => {
    setPending((prev) =>
      prev.map((p) => (p.id === id ? { ...p, kind: value } : p))
    );
  };

  const handleRemove = (id: string) => {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((p) => p.id !== id);
    });
  };

  /**
   * Upload `queue`, then drop only what succeeded.
   *
   * `onlyFailed` is the retry path. It re-sends the error rows and nothing
   * else — the successes are already rows in the database, and re-posting them
   * would duplicate the photo, which is the failure mode "retry" usually
   * introduces.
   */
  const runUpload = useCallback(
    async (onlyFailed: boolean) => {
      if (uploading) return;

      const snapshot = pending;
      if (snapshot.some((p) => p.status === "preparing")) {
        setGlobalError("Please wait for image preparation to finish.");
        return;
      }

      const queue = snapshot.filter((p) =>
        onlyFailed ? p.status === "error" : p.status === "pending" || p.status === "error"
      );
      if (queue.length === 0) return;

      setUploading(true);
      setGlobalError(null);
      setFailedCount(0);
      setPending((prev) =>
        prev.map((p) =>
          queue.some((q) => q.id === p.id)
            ? { ...p, status: "uploading", error: undefined }
            : p
        )
      );

      let failures = 0;

      await runPool(queue, UPLOAD_CONCURRENCY, async (item) => {
        const formData = new FormData();
        formData.append("jobId", jobId);
        formData.append("file", item.file);
        formData.append("kind", item.kind);
        if (item.caption.trim()) {
          formData.append("caption", item.caption.trim());
        }

        try {
          const result = await uploadJobPhoto(formData);
          if (result.success) {
            setPending((prev) =>
              prev.map((p) =>
                p.id === item.id ? { ...p, status: "success" } : p
              )
            );
          } else {
            failures++;
            setPending((prev) =>
              prev.map((p) =>
                p.id === item.id
                  ? {
                      ...p,
                      status: "error",
                      error: result.error || "Upload failed",
                    }
                  : p
              )
            );
          }
        } catch {
          failures++;
          setPending((prev) =>
            prev.map((p) =>
              p.id === item.id
                ? {
                    ...p,
                    status: "error",
                    error: "Upload failed — check your connection and retry.",
                  }
                : p
            )
          );
        }
      });

      setUploading(false);
      setFailedCount(failures);

      // Only successes leave the queue. Failures stay exactly where they are,
      // with their preview, caption and type intact, so "Retry failed" costs
      // the cleaner nothing but a tap.
      setPending((prev) => {
        prev
          .filter((p) => p.status === "success")
          .forEach((p) => URL.revokeObjectURL(p.preview));
        return prev.filter((p) => p.status !== "success");
      });

      onUploaded?.();
    },
    [jobId, onUploaded, pending, uploading]
  );

  const totalAfterUpload = currentPhotoCount + pending.length;
  const isPreparing = pending.some((p) => p.status === "preparing");
  const readyCount = pending.filter(
    (p) => p.status === "pending" || p.status === "error"
  ).length;
  const queuedFailures = pending.filter((p) => p.status === "error").length;
  const kindCounts = useMemo(() => {
    const counts = new Map<JobPhotoKind, number>();
    for (const p of pending) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
    return counts;
  }, [pending]);

  return (
    <div className="space-y-4">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        disabled={uploading || remainingSlots === 0}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void acceptFiles(Array.from(e.target.files));
            e.target.value = "";
          }
        }}
      />

      {/* Photo type — set before adding, so the batch lands filed correctly. */}
      <div className="space-y-2">
        <p className="text-sm font-[400] text-neutral-950">
          What are you adding?
        </p>
        <div className="flex flex-wrap gap-2">
          {JOB_PHOTO_KINDS.map((k) => {
            const active = kind === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={active}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  active
                    ? "bg-[#008C9C] text-white border-[#008C9C]"
                    : "bg-white text-neutral-950/70 border-neutral-950/15 hover:border-[#008C9C]/40"
                }`}>
                {JOB_PHOTO_KIND_LABEL[k]}
                {kindCounts.get(k) ? (
                  <span className={active ? "ml-1.5 opacity-80" : "ml-1.5 opacity-60"}>
                    ({kindCounts.get(k)})
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-neutral-950/60">{JOB_PHOTO_KIND_HINT[kind]}</p>
      </div>

      <div
        {...getRootProps()}
        className={`relative rounded-2xl border-2 border-dashed transition-colors p-6 text-center ${
          isDragActive
            ? "border-[#008C9C] bg-[#008C9C]/5"
            : "border-neutral-950/15 bg-neutral-950/2"
        } ${
          uploading || remainingSlots === 0
            ? "opacity-60 cursor-not-allowed"
            : ""
        }`}>
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-2">
          <div className="p-3 rounded-full bg-[#008C9C]/10">
            <ImagePlus className="w-6 h-6 text-[#008C9C]" />
          </div>
          <p className="text-sm font-[400] text-neutral-950">
            {isDragActive
              ? "Drop photos here"
              : "Drag & drop photos here, or use the buttons below"}
          </p>
          {/* The limit, stated up front rather than after a failed upload. */}
          <p className="text-xs text-neutral-950/60">
            Select as many photos as you need &middot; auto-compressed if large
            &middot; {currentPhotoCount} of {MAX_PHOTOS_PER_JOB} used on this job
          </p>
          <div className="flex gap-2 mt-2">
            <Button
              type="button"
              variant="cleano"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                open();
              }}
              disabled={uploading || remainingSlots === 0}>
              <Upload className="w-4 h-4 mr-1.5" />
              Choose Files
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                openCamera();
              }}
              disabled={uploading || remainingSlots === 0}>
              <Camera className="w-4 h-4 mr-1.5" />
              Take Photo
            </Button>
          </div>
        </div>
      </div>

      {globalError && (
        <div className="p-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-700">
          {globalError}
        </div>
      )}

      {/* Which photos failed, and a retry that leaves the saved ones alone. */}
      {!uploading && queuedFailures > 0 && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            {queuedFailures} photo{queuedFailures === 1 ? "" : "s"} did not
            upload
            {failedCount > 0 ? " — everything else was saved." : "."} They are
            still here; nothing was lost.
          </p>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => void runUpload(true)}
            disabled={uploading}>
            <RotateCw className="w-4 h-4 mr-1.5" />
            Retry {queuedFailures} failed
          </Button>
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-[400] text-neutral-950">
              {pending.length} photo{pending.length === 1 ? "" : "s"} ready to
              upload
            </p>
            <p className="text-xs text-neutral-950/60">
              {totalAfterUpload} / {MAX_PHOTOS_PER_JOB} after upload
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {pending.map((p) => (
              <div
                key={p.id}
                className="rounded-2xl border border-neutral-950/10 bg-white overflow-hidden">
                <div className="relative aspect-video bg-neutral-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.preview}
                    alt="Pending upload preview"
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[11px] bg-black/60 text-white">
                    {JOB_PHOTO_KIND_LABEL[p.kind]}
                  </span>
                  {(p.status === "uploading" || p.status === "preparing") && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-2 text-white text-xs">
                      <Loader className="w-5 h-5 animate-spin" />
                      {p.status === "preparing" ? "Compressing..." : "Uploading..."}
                    </div>
                  )}
                  {p.status !== "uploading" && p.status !== "preparing" && (
                    <button
                      type="button"
                      onClick={() => handleRemove(p.id)}
                      disabled={uploading}
                      className="absolute top-2 right-2 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-50"
                      aria-label="Remove photo">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="p-3 space-y-2">
                  <label className="sr-only" htmlFor={`kind-${p.id}`}>
                    Photo type
                  </label>
                  <select
                    id={`kind-${p.id}`}
                    value={p.kind}
                    onChange={(e) =>
                      handleKindChange(p.id, e.target.value as JobPhotoKind)
                    }
                    disabled={uploading || p.status === "uploading"}
                    className="w-full text-sm rounded-lg border border-neutral-950/10 px-2 py-1.5 bg-white focus:outline-none focus:border-[#008C9C]/40">
                    {JOB_PHOTO_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {JOB_PHOTO_KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={p.caption}
                    onChange={(e) =>
                      handleCaptionChange(p.id, e.target.value)
                    }
                    placeholder="Add a caption (optional)"
                    disabled={uploading || p.status === "uploading"}
                    className="w-full text-sm rounded-lg border border-neutral-950/10 px-2 py-1.5 focus:outline-none focus:border-[#008C9C]/40"
                  />
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-950/60 truncate max-w-[60%]">
                      {p.file.name}
                    </span>
                    <span className="text-neutral-950/50">
                      {(p.file.size / 1024 / 1024).toFixed(2)} MB
                      {p.compressed && (
                        <span className="ml-1 text-[#008C9C]/70">
                          (from {(p.originalSize / 1024 / 1024).toFixed(2)} MB)
                        </span>
                      )}
                    </span>
                  </div>
                  {p.status === "error" && p.error && (
                    <p className="text-xs text-red-600">{p.error}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              variant="action"
              size="md"
              onClick={() => void runUpload(false)}
              loading={uploading}
              disabled={uploading || readyCount === 0 || isPreparing}>
              <Upload className="w-4 h-4 mr-1.5" />
              {isPreparing
                ? "Preparing..."
                : `Upload ${readyCount} Photo${readyCount === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
