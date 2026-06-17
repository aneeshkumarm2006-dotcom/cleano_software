"use client";

import React, { useCallback, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import imageCompression from "browser-image-compression";
import { Camera, Upload, X, Loader, ImagePlus } from "lucide-react";
import Button from "@/components/ui/Button";
import { uploadJobPhoto } from "@/app/(app)/actions/uploadJobPhoto";

const TARGET_MAX_SIZE_MB = 1;
const HARD_MAX_SIZE = 10 * 1024 * 1024;
const COMPRESSION_THRESHOLD = 1 * 1024 * 1024;
const MAX_PHOTOS_PER_JOB = 20;
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

export default function PhotoUpload({
  jobId,
  currentPhotoCount,
  onUploaded,
}: PhotoUploadProps) {
  const [pending, setPending] = useState<PendingPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const remainingSlots = Math.max(0, MAX_PHOTOS_PER_JOB - currentPhotoCount);

  const acceptFiles = useCallback(
    async (incoming: File[]) => {
      setGlobalError(null);
      if (incoming.length === 0) return;

      const availableSlots = remainingSlots - pending.length;
      if (availableSlots <= 0) {
        setGlobalError(
          `Photo limit reached (${MAX_PHOTOS_PER_JOB} per job). Remove pending photos to add more.`
        );
        return;
      }

      const accepted = incoming.slice(0, availableSlots);
      if (accepted.length < incoming.length) {
        setGlobalError(
          `Only added ${accepted.length} of ${incoming.length} photos (limit reached).`
        );
      }

      const placeholders: PendingPhoto[] = accepted.map((file) => ({
        id: genId(),
        file,
        originalSize: file.size,
        compressed: false,
        preview: URL.createObjectURL(file),
        caption: "",
        status: "preparing",
      }));

      setPending((prev) => [...prev, ...placeholders]);

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
    [pending.length, remainingSlots]
  );

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      void acceptFiles(acceptedFiles);
    },
    [acceptFiles]
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
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

  const handleRemove = (id: string) => {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((p) => p.id !== id);
    });
  };

  const handleUploadAll = async () => {
    if (pending.length === 0 || uploading) return;
    if (pending.some((p) => p.status === "preparing")) {
      setGlobalError("Please wait for image preparation to finish.");
      return;
    }

    setUploading(true);
    setGlobalError(null);

    const queue = pending.filter(
      (p) => p.status === "pending" || p.status === "error"
    );

    for (const item of queue) {
      setPending((prev) =>
        prev.map((p) =>
          p.id === item.id
            ? { ...p, status: "uploading", error: undefined }
            : p
        )
      );

      const formData = new FormData();
      formData.append("jobId", jobId);
      formData.append("file", item.file);
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
        setPending((prev) =>
          prev.map((p) =>
            p.id === item.id
              ? { ...p, status: "error", error: "Upload failed" }
              : p
          )
        );
      }
    }

    setUploading(false);

    setPending((prev) => {
      const remaining = prev.filter((p) => p.status !== "success");
      prev
        .filter((p) => p.status === "success")
        .forEach((p) => URL.revokeObjectURL(p.preview));
      return remaining;
    });

    onUploaded?.();
  };

  const totalAfterUpload = currentPhotoCount + pending.length;
  const isPreparing = pending.some((p) => p.status === "preparing");

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
          <p className="text-xs text-neutral-950/60">
            Photos are auto-compressed if needed &middot;{" "}
            {remainingSlots} of {MAX_PHOTOS_PER_JOB} slots left
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
              onClick={handleUploadAll}
              loading={uploading}
              disabled={uploading || pending.length === 0 || isPreparing}>
              <Upload className="w-4 h-4 mr-1.5" />
              {isPreparing
                ? "Preparing..."
                : `Upload ${pending.length} Photo${
                    pending.length === 1 ? "" : "s"
                  }`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
