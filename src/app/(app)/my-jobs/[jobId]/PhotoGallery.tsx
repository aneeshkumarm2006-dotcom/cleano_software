"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Trash2, X, Loader, ChevronLeft, ChevronRight } from "lucide-react";
import { getJobPhotos } from "@/app/(app)/actions/getJobPhotos";
import type { JobPhotoDTO } from "@/app/(app)/actions/getJobPhotos.types";
import { deleteJobPhoto } from "@/app/(app)/actions/deleteJobPhoto";
import { ConfirmDeleteModal } from "@/components/common/ConfirmDeleteModal";
import PhotoUpload from "./PhotoUpload";

interface PhotoGalleryProps {
  jobId: string;
  canUpload: boolean;
  afterPhotosAllowed?: boolean;
}

export default function PhotoGallery({
  jobId,
  canUpload,
  afterPhotosAllowed = true,
}: PhotoGalleryProps) {
  const [photos, setPhotos] = useState<JobPhotoDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getJobPhotos(jobId);
    if (result.success) {
      setPhotos(result.photos);
      setError(null);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  const [photoToDelete, setPhotoToDelete] = useState<string | null>(null);

  const handleDelete = useCallback(
    (photoId: string) => {
      if (deletingId) return;
      setPhotoToDelete(photoId);
    },
    [deletingId]
  );

  const confirmDeletePhoto = useCallback(async () => {
    if (!photoToDelete) return;
    const id = photoToDelete;
    setPhotoToDelete(null);
    setDeletingId(id);
    const result = await deleteJobPhoto(id);
    setDeletingId(null);
    if (result.success) {
      setPhotos((prev) => prev.filter((p) => p.id !== id));
      setLightboxIndex(null);
    } else {
      setError(result.error ?? "Failed to delete photo");
    }
  }, [photoToDelete]);

  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const showPrev = useCallback(() => {
    setLightboxIndex((i) =>
      i === null ? null : (i - 1 + photos.length) % photos.length
    );
  }, [photos.length]);
  const showNext = useCallback(() => {
    setLightboxIndex((i) =>
      i === null ? null : (i + 1) % photos.length
    );
  }, [photos.length]);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") showPrev();
      if (e.key === "ArrowRight") showNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIndex, closeLightbox, showPrev, showNext]);

  const activePhoto =
    lightboxIndex !== null ? photos[lightboxIndex] : null;

  return (
    <div className="space-y-6">
      {canUpload && afterPhotosAllowed && (
        <PhotoUpload
          jobId={jobId}
          currentPhotoCount={photos.length}
          onUploaded={load}
        />
      )}

      {error && (
        <div className="p-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-neutral-950/60">
          <Loader className="w-5 h-5 animate-spin mr-2" />
          Loading photos...
        </div>
      ) : photos.length === 0 ? (
        <div className="py-8 text-center text-sm text-neutral-950/60">
          No photos uploaded yet.
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((photo, idx) => (
            <div
              key={photo.id}
              className="group relative rounded-2xl overflow-hidden border border-neutral-950/10 bg-neutral-100 aspect-square">
              <button
                type="button"
                onClick={() => setLightboxIndex(idx)}
                className="absolute inset-0 cursor-zoom-in"
                aria-label="Enlarge photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={photo.caption || "Job photo"}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  loading="lazy"
                />
              </button>

              {photo.canDelete && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(photo.id);
                  }}
                  disabled={deletingId === photo.id}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                  aria-label="Delete photo">
                  {deletingId === photo.id ? (
                    <Loader className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </button>
              )}

              {(photo.caption || photo.employeeName) && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 pointer-events-none">
                  {photo.caption && (
                    <p className="text-xs text-white truncate">
                      {photo.caption}
                    </p>
                  )}
                  <p className="text-[10px] text-white/70 truncate">
                    {photo.employeeName} &middot;{" "}
                    {new Date(photo.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {activePhoto && (
        <div
          className="fixed inset-0 z-[9999] bg-black/85 flex items-center justify-center p-4"
          onClick={closeLightbox}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              closeLightbox();
            }}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Close">
            <X className="w-5 h-5" />
          </button>

          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  showPrev();
                }}
                className="absolute left-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
                aria-label="Previous photo">
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  showNext();
                }}
                className="absolute right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
                aria-label="Next photo">
                <ChevronRight className="w-6 h-6" />
              </button>
            </>
          )}

          <div
            className="max-w-5xl max-h-[90vh] flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={activePhoto.url}
              alt={activePhoto.caption || "Job photo"}
              className="max-h-[80vh] max-w-full rounded-xl object-contain"
            />
            <div className="text-center text-white/90 max-w-2xl">
              {activePhoto.caption && (
                <p className="text-sm font-[400]">{activePhoto.caption}</p>
              )}
              <p className="text-xs text-white/60 mt-1">
                {activePhoto.employeeName} &middot;{" "}
                {new Date(activePhoto.createdAt).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}
              </p>
              {activePhoto.canDelete && (
                <button
                  type="button"
                  onClick={() => handleDelete(activePhoto.id)}
                  disabled={deletingId === activePhoto.id}
                  className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-red-600/90 text-white text-xs hover:bg-red-600 disabled:opacity-50">
                  {deletingId === activePhoto.id ? (
                    <Loader className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  Delete Photo
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDeleteModal
        isOpen={!!photoToDelete}
        onClose={() => setPhotoToDelete(null)}
        onConfirm={confirmDeletePhoto}
        fileName="this photo"
        title="Delete photo?"
        message="This cannot be undone."
      />
    </div>
  );
}
