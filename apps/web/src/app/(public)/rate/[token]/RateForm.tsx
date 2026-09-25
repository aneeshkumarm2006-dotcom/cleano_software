"use client";

import { useState } from "react";
import imageCompression from "browser-image-compression";
import { Star, Check, AlertCircle, ImagePlus, X, Loader } from "lucide-react";
import SplitShell, { BRAND_IMAGES } from "@/components/customer/SplitShell";
import { Field, Textarea, Button } from "@/components/customer/Field";
import { submitRating } from "../actions/submitRating";
import { uploadReviewPhoto } from "../actions/uploadReviewPhoto";
import { POOR_RATING_FOLLOWUP_STARS } from "@/lib/policy";

const MAX_REVIEW_PHOTOS = 5;
const COMPRESSION_THRESHOLD = 1 * 1024 * 1024;

type ReviewPhoto = {
  id: string;
  preview: string;
  status: "uploading" | "done" | "error";
  url?: string;
  error?: string;
};

async function compressIfNeeded(file: File): Promise<File> {
  if (file.size <= COMPRESSION_THRESHOLD) return file;
  try {
    const compressed = await imageCompression(file, {
      maxSizeMB: 1,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      initialQuality: 0.75,
      fileType: file.type === "image/png" ? "image/jpeg" : undefined,
    });
    if (compressed.size >= file.size) return file;
    return new File(
      [compressed],
      file.name.replace(/\.[^.]+$/, "") +
        (compressed.type === "image/jpeg" ? ".jpg" : ""),
      { type: compressed.type }
    );
  } catch {
    return file;
  }
}

type Fallback = "expired" | "already" | "notfound";

interface Props {
  token: string;
  jobNumber?: number;
  jobDate?: string | null;
  location?: string | null;
  cleaners?: { id: string; name: string }[];
  fallback?: Fallback;
  /** True when the client already rated and is now editing. */
  isEdit?: boolean;
  previousStars?: number | null;
  previousComment?: string | null;
}

const FALLBACK_COPY: Record<
  Fallback,
  { title: string; body: string }
> = {
  expired: {
    title: "Link expired",
    body:
      "This rating link is no longer active. If you'd still like to share feedback, please reach out to us directly.",
  },
  already: {
    title: "Already rated",
    body: "Thanks — we've already received your feedback for this booking.",
  },
  notfound: {
    title: "Link not found",
    body:
      "This rating link is invalid. If you recently received a receipt, double-check the URL.",
  },
};

export default function RateForm({
  token,
  jobNumber,
  jobDate,
  location,
  cleaners = [],
  fallback,
  isEdit = false,
  previousStars,
  previousComment,
}: Props) {
  const [rating, setRating] = useState(isEdit ? previousStars ?? 0 : 0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState(isEdit ? previousComment ?? "" : "");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [photos, setPhotos] = useState<ReviewPhoto[]>([]);

  const isPoor = rating > 0 && rating <= POOR_RATING_FOLLOWUP_STARS;
  const uploadingPhotos = photos.some((p) => p.status === "uploading");

  async function onSelectPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const slots = MAX_REVIEW_PHOTOS - photos.length;
    if (slots <= 0) return;
    const chosen = Array.from(files).slice(0, slots);

    for (const file of chosen) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const preview = URL.createObjectURL(file);
      setPhotos((prev) => [...prev, { id, preview, status: "uploading" }]);
      try {
        const processed = await compressIfNeeded(file);
        const fd = new FormData();
        fd.append("token", token);
        fd.append("file", processed);
        const res = await uploadReviewPhoto(fd);
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === id
              ? res.success
                ? { ...p, status: "done", url: res.url }
                : { ...p, status: "error", error: res.error }
              : p
          )
        );
      } catch {
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === id
              ? { ...p, status: "error", error: "Upload failed" }
              : p
          )
        );
      }
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating || uploadingPhotos) return;
    setSubmitting(true);
    if (fallback) {
      // Demo route — just animate.
      setTimeout(() => {
        setSubmitting(false);
        setSubmitted(true);
      }, 700);
      return;
    }
    const photoUrls = isPoor
      ? photos
          .filter((p) => p.status === "done" && p.url)
          .map((p) => p.url as string)
      : [];
    const res = await submitRating({ token, stars: rating, comment, photoUrls });
    setSubmitting(false);
    if (res.success) setSubmitted(true);
  }

  const dateStr = jobDate
    ? new Date(jobDate).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null;
  const cleanerLabel =
    cleaners.length === 0
      ? "your team"
      : cleaners.length === 1
      ? cleaners[0].name
      : cleaners.map((c) => c.name).join(" & ");

  return (
    <SplitShell
      image={BRAND_IMAGES.rate}
      quoteHtml={"Your feedback<br/>shapes <em>every visit.</em>"}
      quoteSub="It takes 30 seconds — and goes straight to your cleaner."
      badge="Rate your cleaning">
      {submitted ? (
        <SubmittedState />
      ) : fallback ? (
        <FallbackState
          title={FALLBACK_COPY[fallback].title}
          body={FALLBACK_COPY[fallback].body}
        />
      ) : (
        <form onSubmit={onSubmit}>
          <header style={{ marginBottom: 24 }}>
            <p className="cl-eyebrow" style={{ marginBottom: 12 }}>
              Job #{jobNumber}
            </p>
            <h1
              className="cl-display"
              style={{ fontSize: "clamp(32px, 4.4vw, 52px)" }}>
              {isEdit ? (
                <>
                  Update your
                  <br />
                  <em>rating</em>
                </>
              ) : (
                <>
                  How was your
                  <br />
                  <em>cleaning?</em>
                </>
              )}
            </h1>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px 18px",
                padding: "16px 0 0",
                fontSize: 13,
                color: "var(--primary-70)",
              }}>
              {dateStr ? (
                <span>
                  <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
                    {dateStr}
                  </strong>
                </span>
              ) : null}
              {location ? <span>· {location}</span> : null}
            </div>
            <p className="cl-subtitle">
              {isEdit
                ? `You already rated this cleaning — you can change your rating for ${cleanerLabel} below.`
                : `Rate your experience with ${cleanerLabel}.`}
            </p>
          </header>

          <div className="cl-star-row" aria-label="Rate from 1 to 5 stars">
            {[1, 2, 3, 4, 5].map((n) => {
              const active = (hover || rating) >= n;
              return (
                <button
                  key={n}
                  type="button"
                  className={`cl-star-btn ${active ? "filled" : ""} ${
                    hover === n ? "preview" : ""
                  }`}
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                  onMouseEnter={() => setHover(n)}
                  onMouseLeave={() => setHover(0)}
                  onClick={() => setRating(n)}>
                  <Star
                    size={48}
                    strokeWidth={1.5}
                    fill={active ? "currentColor" : "transparent"}
                  />
                </button>
              );
            })}
          </div>

          <div className="cl-stack-20">
            <Field
              label="Want to add a comment? (optional)"
              htmlFor="rate-comment">
              <Textarea
                id="rate-comment"
                rows={4}
                maxLength={1000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Anything that stood out, good or bad…"
              />
            </Field>

            {isPoor && (
              <Field
                label="Add photos so we can make it right (optional)"
                htmlFor="rate-photos">
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    alignItems: "center",
                  }}>
                  {photos.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        position: "relative",
                        width: 72,
                        height: 72,
                        borderRadius: 12,
                        overflow: "hidden",
                        background: "var(--primary-5)",
                        border: "1px solid var(--primary-10)",
                      }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.preview}
                        alt="Review attachment"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          opacity: p.status === "done" ? 1 : 0.5,
                        }}
                      />
                      {p.status === "uploading" && (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#fff",
                            background: "rgba(0,0,0,0.35)",
                          }}>
                          <Loader
                            size={18}
                            style={{ animation: "cl-spin 0.8s linear infinite" }}
                          />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removePhoto(p.id)}
                        aria-label="Remove photo"
                        style={{
                          position: "absolute",
                          top: 3,
                          right: 3,
                          width: 20,
                          height: 20,
                          borderRadius: "50%",
                          border: "none",
                          background: "rgba(0,0,0,0.6)",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                        }}>
                        <X size={12} />
                      </button>
                      {p.status === "error" && (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 10,
                            color: "#fff",
                            background: "rgba(185,28,28,0.7)",
                            padding: 4,
                            textAlign: "center",
                          }}>
                          Failed
                        </div>
                      )}
                    </div>
                  ))}
                  {photos.length < MAX_REVIEW_PHOTOS && (
                    <label
                      htmlFor="rate-photos"
                      style={{
                        width: 72,
                        height: 72,
                        borderRadius: 12,
                        border: "1px dashed var(--primary-30)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 4,
                        cursor: "pointer",
                        color: "var(--primary-70)",
                        fontSize: 10,
                      }}>
                      <ImagePlus size={20} />
                      Add
                    </label>
                  )}
                </div>
                <input
                  id="rate-photos"
                  type="file"
                  accept="image/jpeg,image/png,image/heic,image/heif,image/webp"
                  multiple
                  style={{ display: "none" }}
                  onChange={(e) => {
                    void onSelectPhotos(e.target.files);
                    e.target.value = "";
                  }}
                />
              </Field>
            )}

            <Button
              type="submit"
              size="lg"
              block
              loading={submitting}
              disabled={!rating || uploadingPhotos}>
              {submitting
                ? "Submitting…"
                : uploadingPhotos
                ? "Uploading photos…"
                : isEdit
                ? "Update rating →"
                : "Submit rating →"}
            </Button>
          </div>
        </form>
      )}
    </SplitShell>
  );
}

function FallbackState({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ textAlign: "center", padding: "24px 0" }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: "var(--primary-5)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--primary)",
          marginBottom: 20,
        }}>
        <AlertCircle size={28} />
      </div>
      <h1 className="cl-title" style={{ marginBottom: 12 }}>
        {title}
      </h1>
      <p
        className="cl-subtitle"
        style={{ fontSize: 15, maxWidth: 380, margin: "0 auto" }}>
        {body}
      </p>
    </div>
  );
}

function SubmittedState() {
  return (
    <div style={{ textAlign: "center", padding: "32px 0" }}>
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: "var(--emerald-100)",
          color: "var(--emerald-600)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 24px",
        }}>
        <Check size={36} strokeWidth={2.5} />
      </div>
      <h1
        className="cl-display"
        style={{ fontSize: "clamp(28px, 3.6vw, 42px)", marginBottom: 14 }}>
        Thanks for the
        <br />
        <em>feedback!</em>
      </h1>
      <p
        className="cl-subtitle"
        style={{ maxWidth: 380, margin: "0 auto", fontSize: 15 }}>
        We'll make sure your cleaner sees it. We'd love to have you back soon.
      </p>
    </div>
  );
}
