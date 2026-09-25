// The photo upload queue: what's being prepared, sent and saved, per job.
//
// It lives outside any screen, so leaving the photos screen doesn't cancel an
// upload, and coming back shows where each one got to. Each photo moves
// through three steps, and a retry picks up at the step that failed — a photo
// that reached storage is never sent twice, and the attach carries the same
// clientEventId every time, so the server files it once.
//
//   prepare (shrink, re-encode) → send (sign, PUT) → save (attach by key)
//
// Held in memory: photos not yet sent are lost if the app is closed. The
// person sees each photo's state and is never told one was saved when it
// wasn't.
import { ApiError } from "@bookmops/api/client";
import type { PhotoPhase, UploadTicket } from "@bookmops/api/v1";
import type { QueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { addPhotoToCache, photoKeys } from "@/data/queries/photos";
import type { DataSource } from "@/data/source";

import { type PreparedPhoto, preparePhoto, putPhoto, UploadError } from "./upload";

/** Two at a time: enough to hide latency, few enough not to choke a weak signal. */
const CONCURRENCY = 2;
/** Signed URLs last 15 minutes; get a fresh one well before that. */
const TICKET_MAX_AGE_MS = 10 * 60_000;

export type UploadStep = "waiting" | "preparing" | "sending" | "saving" | "failed";

export interface UploadItem {
  id: string;
  jobId: string;
  owner: string;
  phase: PhotoPhase;
  /** What to show in the queue: the picked photo, then its shrunk copy. */
  previewUri: string;
  step: UploadStep;
  /** 0–1, while sending. */
  progress: number;
  error: string | null;
  /** Whether "Try again" can help. */
  canRetry: boolean;
}

interface Internal extends UploadItem {
  asset: { uri: string; width: number; height: number };
  maxBytes: number;
  prepared: PreparedPhoto | null;
  ticket: UploadTicket | null;
  /** When the ticket was issued, on the monotonic clock. */
  ticketAt: number;
  sent: boolean;
  clientEventId: string;
  ctx: { source: DataSource; qc: QueryClient };
}

let items: Internal[] = [];
let snapshot: readonly UploadItem[] = [];
const listeners = new Set<() => void>();
let active = 0;

/** Photos this phone just sent, by server id: shown from the phone, not re-downloaded. */
const localUris = new Map<string, string>();
export const localPhotoUri = (photoId: string) => localUris.get(photoId);
export const forgetLocalPhoto = (photoId: string) => void localUris.delete(photoId);

function emit() {
  snapshot = items.map(
    ({ id, jobId, owner, phase, previewUri, step, progress, error, canRetry }): UploadItem => ({
      id,
      jobId,
      owner,
      phase,
      previewUri,
      step,
      progress,
      error,
      canRetry,
    }),
  );
  for (const l of listeners) l();
}

function patch(id: string, change: Partial<Internal>) {
  items = items.map((i) => (i.id === id ? { ...i, ...change } : i));
  emit();
}

const get = (id: string) => items.find((i) => i.id === id);

function pump() {
  while (active < CONCURRENCY) {
    const next = items.find((i) => i.step === "waiting");
    if (!next) return;
    active++;
    patch(next.id, { step: next.prepared ? (next.sent ? "saving" : "sending") : "preparing" });
    void run(next.id).finally(() => {
      active--;
      pump();
    });
  }
}

async function run(id: string): Promise<void> {
  let item = get(id);
  if (!item) return;
  const { source, qc } = item.ctx;
  try {
    if (!item.prepared) {
      const prepared = await preparePhoto(item.asset);
      if (prepared.byteSize > item.maxBytes) {
        throw new UploadError(`This photo is over ${Math.round(item.maxBytes / 1024 / 1024)} MB even after shrinking. Try another.`, false);
      }
      patch(id, { prepared, previewUri: prepared.uri, step: "sending" });
      item = get(id)!;
    }

    if (!item.sent) {
      let ticket = item.ticket;
      if (!ticket || performance.now() - item.ticketAt > TICKET_MAX_AGE_MS) {
        ticket = await source.createJobPhotoUpload({
          purpose: "JOB_PHOTO",
          jobId: item.jobId,
          contentType: item.prepared!.contentType,
          byteSize: item.prepared!.byteSize,
        });
        patch(id, { ticket, ticketAt: performance.now() });
      }
      try {
        await putPhoto(ticket, item.prepared!, (progress) => patch(id, { progress }));
      } catch (e) {
        if (e instanceof UploadError && e.needsNewTicket) patch(id, { ticket: null });
        throw e;
      }
      patch(id, { sent: true, step: "saving" });
      item = get(id)!;
    }

    const photo = await source.attachJobPhoto(item.jobId, {
      key: item.ticket!.key,
      phase: item.phase,
      clientEventId: item.clientEventId,
    });
    localUris.set(photo.id, item.prepared!.uri);
    addPhotoToCache(qc, item.jobId, photo);
    items = items.filter((i) => i.id !== id);
    emit();
    if (!items.some((i) => i.jobId === item!.jobId && i.step !== "failed")) {
      void qc.invalidateQueries({ queryKey: photoKeys.photos(item.jobId) });
    }
  } catch (e) {
    const { message, canRetry, resend } = describe(e);
    patch(id, { step: "failed", error: message, canRetry, ...(resend ? { sent: false, ticket: null } : null) });
  }
}

function describe(e: unknown): { message: string; canRetry: boolean; resend?: boolean } {
  if (e instanceof UploadError) return { message: e.message, canRetry: e.retryable };
  if (e instanceof ApiError) {
    if (e.signedOut) return { message: "Sign in again to send this photo.", canRetry: true };
    // Storage doesn't have it (yet): the PUT may still be landing, or was lost.
    if (e.code === "UPLOAD_MISSING") return { message: e.message, canRetry: true, resend: !e.retryable };
    return { message: e.message, canRetry: e.retryable };
  }
  return { message: "Something went wrong. Try again.", canRetry: true };
}

// ── The hook ────────────────────────────────────────────────────────────────

function subscribe(l: () => void) {
  listeners.add(l);
  return () => void listeners.delete(l);
}
const read = () => snapshot;

/**
 * The upload queue for one job, for the signed-in person only: another person
 * signing in on the same phone never sees, or sends, someone else's photos.
 */
export function usePhotoUploads(jobId: string, owner: string | null, source: DataSource, qc: QueryClient) {
  const all = useSyncExternalStore(subscribe, read);
  const mine = useMemo(() => all.filter((i) => i.jobId === jobId && i.owner === owner), [all, jobId, owner]);

  const add = useCallback(
    (assets: readonly { uri: string; width: number; height: number }[], phase: PhotoPhase, maxBytes: number) => {
      if (!owner) return;
      const added: Internal[] = assets.map((asset) => ({
        id: randomUUID(),
        jobId,
        owner,
        phase,
        previewUri: asset.uri,
        step: "waiting",
        progress: 0,
        error: null,
        canRetry: true,
        asset: { uri: asset.uri, width: asset.width, height: asset.height },
        maxBytes,
        prepared: null,
        ticket: null,
        ticketAt: 0,
        sent: false,
        clientEventId: randomUUID(),
        ctx: { source, qc },
      }));
      items = [...items, ...added];
      emit();
      pump();
    },
    [jobId, owner, source, qc],
  );

  const retry = useCallback(
    (id?: string) => {
      items = items.map((i) =>
        i.jobId === jobId && i.owner === owner && i.step === "failed" && i.canRetry && (!id || i.id === id)
          ? { ...i, step: "waiting", error: null, progress: 0, ctx: { source, qc } }
          : i,
      );
      emit();
      pump();
    },
    [jobId, owner, source, qc],
  );

  const remove = useCallback((id: string) => {
    // Only a photo that isn't mid-flight can be dropped.
    items = items.filter((i) => !(i.id === id && (i.step === "failed" || i.step === "waiting")));
    emit();
  }, []);

  return { items: mine, add, retry, remove };
}
