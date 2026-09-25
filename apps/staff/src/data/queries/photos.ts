import { ApiError } from "@bookmops/api/client";
import type { JobPhoto, JobPhotosResponse } from "@bookmops/api/v1";
import { type InfiniteData, type QueryClient, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { useSource } from "../session";

export const photoKeys = {
  photos: (jobId: string) => ["photos", jobId] as const,
};

type PhotoPages = InfiniteData<JobPhotosResponse, string | null>;

/** Every photo on a job, newest first, a page at a time. */
export function useJobPhotos(jobId: string) {
  const source = useSource();
  return useInfiniteQuery({
    queryKey: photoKeys.photos(jobId),
    queryFn: ({ pageParam }) => source.jobPhotos(jobId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Show a photo the server just accepted, without waiting for a refetch. */
export function addPhotoToCache(qc: QueryClient, jobId: string, photo: JobPhoto): void {
  qc.setQueryData<PhotoPages>(photoKeys.photos(jobId), (prev) => {
    if (!prev?.pages[0]) return prev;
    // An idempotent retry returns the same photo: never show it twice.
    if (prev.pages.some((p) => p.items.some((i) => i.id === photo.id))) return prev;
    const [first, ...rest] = prev.pages;
    return {
      ...prev,
      pages: [{ ...first, items: [photo, ...first.items], total: first.total + 1 }, ...rest.map((p) => ({ ...p, total: p.total + 1 }))],
    };
  });
}

function removePhotoFromCache(qc: QueryClient, jobId: string, photoId: string): void {
  qc.setQueryData<PhotoPages>(photoKeys.photos(jobId), (prev) =>
    prev
      ? {
          ...prev,
          pages: prev.pages.map((p) => {
            const items = p.items.filter((i) => i.id !== photoId);
            return { ...p, items, total: Math.max(0, p.total - (items.length < p.items.length ? 1 : 0)) };
          }),
        }
      : prev,
  );
}

/** Delete one of your own photos. Already gone counts as done. */
export function useDeletePhoto(jobId: string) {
  const source = useSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (photoId: string) => {
      try {
        await source.deleteJobPhoto(jobId, photoId);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
      return photoId;
    },
    onSuccess: (photoId) => {
      removePhotoFromCache(qc, jobId, photoId);
      void qc.invalidateQueries({ queryKey: photoKeys.photos(jobId) });
    },
  });
}
