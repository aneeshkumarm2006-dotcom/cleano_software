"use client";

/**
 * "Something's wrong" — the cleaner's end of the job-issue feature.
 *
 * The sheet is the clock-out sheet's skeleton (`.co-overlay` > `.co-sheet` >
 * head/body/footer, portalled to the body) because a cleaner who has used one
 * has used both. What differs is the confirm button: `.co-btn-confirm` is red,
 * built for a clock-out, and a red button on the one action we want a blocked
 * cleaner to take reads as a warning. `.neutral` is the same button in the
 * app's primary colour.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import imageCompression from "browser-image-compression";
import { Camera, Loader, TriangleAlert, X } from "lucide-react";
import { uploadJobPhoto } from "@/app/admin/actions/uploadJobPhoto";
import {
  JOB_ISSUE_CATEGORIES,
  JOB_ISSUE_CATEGORY_HINT,
  JOB_ISSUE_CATEGORY_LABEL,
  MAX_ISSUE_DESCRIPTION,
  type JobIssueCategory,
  type JobIssueUrgency,
} from "@/lib/job-issues";
import { reportJobIssue } from "./reportIssue";

/**
 * The urgency copy is FIRST PERSON here and only here.
 *
 * `JOB_ISSUE_URGENCY_LABEL` in @/lib/job-issues is the office's wording
 * ("Urgent — I'm blocked"), which is what the admin list prints. On the phone
 * the cleaner is answering a question about their own morning, so the options
 * are phrased the way they'd say it. Two values, closed union — the lib's own
 * note explains why this one will not grow a third.
 */
const URGENCY_COPY: Record<JobIssueUrgency, string> = {
  NORMAL: "Can wait",
  URGENT: "I'm blocked right now",
};

/** Mirrors PhotoUpload.tsx — same picker filter, same ceilings, one photo. */
const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
];
const HARD_MAX_SIZE = 10 * 1024 * 1024;
const COMPRESSION_THRESHOLD = 1 * 1024 * 1024;

/** Show the countdown only near the cap, so it isn't nagging from character 1. */
const COUNT_VISIBLE_FROM = Math.floor(MAX_ISSUE_DESCRIPTION * 0.8);

/**
 * Shrink anything over 1MB before it leaves the phone.
 *
 * A photo of a locked door is 4MB+ straight off the camera, and on site wifi
 * that is the difference between the report sending and the cleaner giving up.
 * Compression failing is never fatal — the original still goes, and the 10MB
 * ceiling below catches what is genuinely too big.
 */
async function compressIfNeeded(file: File): Promise<File> {
  if (file.size <= COMPRESSION_THRESHOLD) return file;
  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: 1,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      initialQuality: 0.75,
      alwaysKeepResolution: false,
      fileType: file.type === "image/png" ? "image/jpeg" : undefined,
    });
    if (compressed.size >= file.size) return file;
    return new File(
      [compressed],
      file.name.replace(/\.[^.]+$/, "") +
        (compressed.type === "image/jpeg" ? ".jpg" : ""),
      { type: compressed.type }
    );
  } catch (err) {
    console.error("Issue photo compression failed, using original:", err);
    return file;
  }
}

export default function ReportIssueButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Deliberately no default category. OTHER is the server's fallback, and the
  // lib's own note keeps it last so it is "never the easy first tap" — starting
  // on it would make it the answer for every report nobody thought about.
  const [category, setCategory] = useState<JobIssueCategory | null>(null);
  const [urgency, setUrgency] = useState<JobIssueUrgency>("NORMAL");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<{ file: File; preview: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [phase, setPhase] = useState<"idle" | "uploading" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== "idle";
  const remaining = MAX_ISSUE_DESCRIPTION - description.length;

  function reset() {
    if (photo) URL.revokeObjectURL(photo.preview);
    setCategory(null);
    setUrgency("NORMAL");
    setDescription("");
    setPhoto(null);
    setPreparing(false);
    setPhase("idle");
    setError(null);
  }

  function close() {
    if (busy || preparing) return;
    setOpen(false);
    reset();
  }

  async function handlePickPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("That file isn't a photo. Use JPG, PNG, HEIC or WebP.");
      return;
    }
    setPreparing(true);
    try {
      const processed = await compressIfNeeded(file);
      if (processed.size > HARD_MAX_SIZE) {
        setError("That photo is still over 10MB after compression. Try another.");
        return;
      }
      if (photo) URL.revokeObjectURL(photo.preview);
      setPhoto({ file: processed, preview: URL.createObjectURL(processed) });
    } finally {
      setPreparing(false);
    }
  }

  function removePhoto() {
    if (photo) URL.revokeObjectURL(photo.preview);
    setPhoto(null);
  }

  async function handleSubmit() {
    // Re-entry guard, same reason as the clock-out sheet's: a double tap on a
    // laggy phone can land two events before React disables the button.
    if (busy || preparing) return;
    setError(null);

    let photoId: string | null = null;
    if (photo) {
      setPhase("uploading");
      try {
        const formData = new FormData();
        formData.append("jobId", jobId);
        formData.append("file", photo.file);
        // ISSUE is exempt from the after-photo consent gate and from the
        // "photos added" client email — see uploadJobPhoto.
        formData.append("kind", "ISSUE");
        const result = await uploadJobPhoto(formData);
        // `photo` is checked alongside `success` because uploadJobPhoto declares
        // no return type, so its two shapes are a plain union rather than a
        // discriminated one — TS cannot narrow on `success` alone.
        if (!result.success || !result.photo) {
          setPhase("idle");
          setError(
            `${result.error || "The photo didn't upload"} — tap Send again, or remove the photo to send the report without it.`
          );
          return;
        }
        photoId = result.photo.id;
      } catch (e) {
        console.error("report-issue photo", e);
        setPhase("idle");
        setError(
          "The photo didn't upload — check your signal and tap Send again, or remove it to send the report without it."
        );
        return;
      }
    }

    setPhase("sending");
    try {
      const result = await reportJobIssue({
        jobId,
        // An unpicked category arrives as "" and the server folds it to OTHER
        // rather than refusing the report. That is its documented contract.
        category: category ?? "",
        urgency,
        description,
        photoId,
      });
      if (result.success) {
        setOpen(false);
        reset();
        router.refresh();
      } else {
        setPhase("idle");
        setError(result.error);
      }
    } catch (e) {
      console.error("report-issue", e);
      setPhase("idle");
      setError("We couldn't reach the server. Check your signal and tap Send again.");
    }
  }

  const modal = open ? (
    <div className="co-overlay" onClick={close}>
      <div className="co-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="co-head">
          <div className="co-head-left">
            <span className="co-head-icon">
              <TriangleAlert size={18} />
            </span>
            <div>
              <h2 className="co-title">Report an issue</h2>
              <p className="co-subtitle">
                Tell the office what happened. It reaches them with the job attached.
              </p>
            </div>
          </div>
          <button className="co-close" onClick={close} aria-label="Close">
            <X size={16} strokeWidth={2.2} />
          </button>
        </div>

        <div className="co-body">
          {/* 1 — what it's about */}
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="co-input-label" style={{ padding: 0, marginBottom: 8 }}>
              What&apos;s the problem?
            </legend>
            <div className="co-choice" role="radiogroup" aria-label="Issue category">
              {JOB_ISSUE_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={category === c}
                  disabled={busy}
                  onClick={() => setCategory(c)}
                  className={`co-choice-row${category === c ? " selected" : ""}`}>
                  <span className="co-choice-mark" aria-hidden="true" />
                  <span className="co-choice-text">
                    <span className="co-choice-label">
                      {JOB_ISSUE_CATEGORY_LABEL[c]}
                    </span>
                    <span className="co-choice-hint">
                      {JOB_ISSUE_CATEGORY_HINT[c]}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          {/* 2 — how fast the office has to look */}
          <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className="co-input-label" style={{ padding: 0, marginBottom: 8 }}>
              How urgent is it?
            </legend>
            <div className="co-choice" role="radiogroup" aria-label="Urgency">
              {(["NORMAL", "URGENT"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  role="radio"
                  aria-checked={urgency === u}
                  disabled={busy}
                  onClick={() => setUrgency(u)}
                  className={`co-choice-row${urgency === u ? " selected" : ""}`}>
                  <span className="co-choice-mark" aria-hidden="true" />
                  <span className="co-choice-text">
                    <span className="co-choice-label">{URGENCY_COPY[u]}</span>
                  </span>
                </button>
              ))}
            </div>
            {/* Same amber as the clock-out checklist gate. It states a
                consequence rather than blocking anything. */}
            {urgency === "URGENT" && (
              <div
                style={{
                  marginTop: 10,
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  color: "#b45309",
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}>
                <strong>The office is emailed straight away.</strong> Use this
                when you can&apos;t carry on with the job until someone answers.
              </div>
            )}
          </fieldset>

          {/* 3 — the account. The only required field. */}
          <div className="co-input-row">
            <label className="co-input-label" htmlFor="issue-description">
              What happened?
            </label>
            <textarea
              id="issue-description"
              className="co-input"
              rows={4}
              value={description}
              maxLength={MAX_ISSUE_DESCRIPTION}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Where you are, what you tried, what you need."
              style={{ resize: "vertical", lineHeight: 1.5 }}
            />
            {description.length >= COUNT_VISIBLE_FROM && (
              <p
                className="co-input-hint"
                style={{ color: remaining === 0 ? "var(--error)" : undefined }}>
                {remaining} character{remaining === 1 ? "" : "s"} left.
              </p>
            )}
          </div>

          {/* 4 — one photo, optional. Uploaded on send, not on pick, so backing
              out of the sheet never leaves an orphan photo on the job. */}
          <div className="co-input-row">
            <span className="co-input-label">Photo (optional)</span>
            {photo ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.preview}
                  alt="Photo attached to this report"
                  style={{
                    width: 72,
                    height: 72,
                    objectFit: "cover",
                    borderRadius: 12,
                    border: "1px solid var(--primary-10)",
                  }}
                />
                <button
                  type="button"
                  className="co-refill-btn"
                  disabled={busy}
                  onClick={removePhoto}>
                  Remove photo
                </button>
              </div>
            ) : (
              <label
                className="co-choice-row"
                style={{ alignItems: "center", opacity: preparing || busy ? 0.55 : 1 }}>
                {preparing ? (
                  <Loader
                    size={18}
                    style={{ animation: "co-spin 0.8s linear infinite", flexShrink: 0 }}
                  />
                ) : (
                  <Camera size={18} style={{ flexShrink: 0, color: "var(--primary)" }} />
                )}
                <span className="co-choice-text">
                  <span className="co-choice-label">
                    {preparing ? "Preparing photo…" : "Add a photo"}
                  </span>
                  <span className="co-choice-hint">
                    Shrunk on your phone before it&apos;s sent.
                  </span>
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={preparing || busy}
                  style={{ display: "none" }}
                  onChange={(e) => {
                    void handlePickPhoto(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>

          {error && (
            <p style={{ fontSize: 13, color: "var(--error)", margin: 0, lineHeight: 1.5 }}>
              {error}
            </p>
          )}
        </div>

        <div className="co-footer">
          <button className="co-btn-ghost" onClick={close} disabled={busy || preparing}>
            Cancel
          </button>
          <button
            className="co-btn-confirm neutral"
            onClick={handleSubmit}
            disabled={busy || preparing || description.trim().length === 0}>
            {busy ? (
              <>
                <Loader size={15} style={{ animation: "co-spin 0.8s linear infinite" }} />
                {phase === "uploading" ? "Uploading photo…" : "Sending…"}
              </>
            ) : (
              <>
                <TriangleAlert size={15} />
                Send report
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button className="cl-jd-issue-btn" onClick={() => setOpen(true)}>
        <TriangleAlert size={14} />
        Report an issue
      </button>
      {typeof window !== "undefined" && modal
        ? createPortal(modal, document.body)
        : null}
    </>
  );
}
