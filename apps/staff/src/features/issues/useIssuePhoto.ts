// The one optional photo on an issue report. It is picked and shrunk right
// away, but only sent when the report is: backing out of the form never leaves
// a stray photo on the job. Once it has reached storage, a retry of the report
// reuses the same upload rather than sending it again.
import { ApiError } from "@bookmops/api/client";
import type { ImagePickerAsset } from "expo-image-picker";
import { useCallback, useRef, useState } from "react";

import type { DataSource } from "@/data/source";
import { pickPhotos, type PreparedPhoto, preparePhoto, putPhoto, UploadError } from "@/features/photos/upload";

export interface IssuePhoto {
  uri: string;
  status: "preparing" | "ready" | "sending" | "sent";
  progress: number;
}

export function useIssuePhoto(jobId: string, source: DataSource, maxBytes = 10 * 1024 * 1024) {
  const [photo, setPhoto] = useState<IssuePhoto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prepared = useRef<PreparedPhoto | null>(null);
  const key = useRef<string | null>(null);
  // Which pick is current, so a slow shrink of a replaced photo is ignored.
  const generation = useRef(0);

  const clear = useCallback(() => {
    generation.current++;
    prepared.current = null;
    key.current = null;
    setPhoto(null);
    setError(null);
  }, []);

  const pick = useCallback(
    async (from: "camera" | "library") => {
      setError(null);
      let assets: ImagePickerAsset[] | null;
      try {
        assets = await pickPhotos(from, 1);
      } catch {
        setError("Couldn't open the camera. Try your library instead.");
        return;
      }
      const asset = assets?.[0];
      if (!asset) return;
      const gen = ++generation.current;
      prepared.current = null;
      key.current = null;
      setPhoto({ uri: asset.uri, status: "preparing", progress: 0 });
      try {
        const p = await preparePhoto(asset);
        if (gen !== generation.current) return;
        if (p.byteSize > maxBytes) {
          clear();
          setError("That photo is too big even after shrinking. Try another.");
          return;
        }
        prepared.current = p;
        setPhoto({ uri: p.uri, status: "ready", progress: 0 });
      } catch (e) {
        if (gen !== generation.current) return;
        clear();
        setError(e instanceof UploadError ? e.message : "This photo couldn't be read. Try another.");
      }
    },
    [clear, maxBytes],
  );

  /**
   * Send the photo if it hasn't been, and return its key. Null when there's
   * no photo. Throws an Error whose message is written for the cleaner.
   */
  const upload = useCallback(async (): Promise<string | null> => {
    if (!photo) return null;
    if (key.current) return key.current;
    const p = prepared.current;
    if (!p) throw new Error("The photo is still getting ready. Try again in a second.");
    setPhoto((s) => (s ? { ...s, status: "sending", progress: 0 } : s));
    try {
      const ticket = await source.createJobPhotoUpload({ purpose: "JOB_PHOTO", jobId, contentType: p.contentType, byteSize: p.byteSize });
      await putPhoto(ticket, p, (progress) => setPhoto((s) => (s ? { ...s, progress } : s)));
      key.current = ticket.key;
      setPhoto((s) => (s ? { ...s, status: "sent", progress: 1 } : s));
      return ticket.key;
    } catch (e) {
      setPhoto((s) => (s ? { ...s, status: "ready", progress: 0 } : s));
      const why = e instanceof UploadError || e instanceof ApiError ? e.message : "The photo didn't send.";
      throw new Error(`${why} Send again, or remove the photo to send the report without it.`);
    }
  }, [photo, jobId, source]);

  return { photo, error, pick, clear, upload };
}
