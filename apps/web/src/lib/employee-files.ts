// Rules for employee-uploaded payroll files (awerfixes.pdf item 16 — void
// cheque / direct deposit info).
//
// PURE module — no Prisma client, no `db`, no `next/headers`, no cloudinary. It
// is imported by the server action that performs the upload AND by the client
// card that pre-checks the file before sending it, so it must stay bundleable
// on both sides. Same constraint `service-permissions.ts` and `availability.ts`
// document, for the same reason: one rule, two callers, no drift.
//
// The point of putting the limits here rather than inline in the action is that
// the browser and the server then reject the same files for the same stated
// reason — a cleaner never gets "upload failed" after waiting for an 11 MB
// upload the server was always going to refuse.

/** The only `EmployeeFile.kind` in use today. See the model's doc comment. */
export const VOID_CHEQUE_KIND = "VOID_CHEQUE";

/** 8 MB, matching `uploadResume` — the closest existing precedent. */
export const MAX_VOID_CHEQUE_BYTES = 8 * 1024 * 1024;

/**
 * A photo of a cheque or a PDF from the bank. Deliberately NARROWER than the
 * job-photo allowlist: no HEIC, no WebP, no GIF. A void cheque is read by a
 * human in the admin panel and forwarded to a payroll provider, and both of
 * those want a format that opens anywhere.
 */
export const VOID_CHEQUE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
] as const;

/** What the file input advertises, kept beside the list it must agree with. */
export const VOID_CHEQUE_ACCEPT = ".pdf,.jpg,.jpeg,.png";

/** Label the client sees. Defined once so the two surfaces cannot disagree. */
export const VOID_CHEQUE_LABEL = "Void Cheque / Direct Deposit Info";

/**
 * Cloudinary stores PDFs as `raw` and images as `image`, and a signed URL must
 * name the right one — so the resource type is derived from the MIME type at
 * upload time and stored on the row, never guessed at read time.
 */
export function resourceTypeFor(mimeType: string): "image" | "raw" {
  return mimeType.trim().toLowerCase() === "application/pdf" ? "raw" : "image";
}

/**
 * Validate a candidate upload. Returns the message to show, or `null` when the
 * file is acceptable — the same "null means nothing to say" shape as
 * `categoryMismatchWarning` and `availabilityWarning`, so callers can render
 * the truthy result directly.
 */
export function validateVoidCheque(file: {
  size: number;
  type: string;
}): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_VOID_CHEQUE_BYTES) {
    return "File exceeds the 8MB limit.";
  }
  const type = file.type.trim().toLowerCase();
  if (!(VOID_CHEQUE_TYPES as readonly string[]).includes(type)) {
    return "Use a PDF, JPG or PNG.";
  }
  return null;
}

// ── Applicant portal documents (decision D4) ────────────────────────────────
// Same shape as the void-cheque rules above, kept as a separate `kind` so an
// applicant's uploads and an employee's payroll file never mix, and reusing
// the same limits/types since a résumé, ID or certification wants the same
// "opens anywhere" formats a void cheque does.

/** Documents an invited applicant uploads from their portal. */
export const APPLICANT_DOCUMENT_KIND = "APPLICANT_DOCUMENT";

export const MAX_APPLICANT_DOCUMENT_BYTES = 8 * 1024 * 1024;

export const APPLICANT_DOCUMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
] as const;

export const APPLICANT_DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png";

export const APPLICANT_DOCUMENT_LABEL = "Supporting documents";

export function validateApplicantDocument(file: {
  size: number;
  type: string;
}): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_APPLICANT_DOCUMENT_BYTES) {
    return "File exceeds the 8MB limit.";
  }
  const type = file.type.trim().toLowerCase();
  if (!(APPLICANT_DOCUMENT_TYPES as readonly string[]).includes(type)) {
    return "Use a PDF, JPG or PNG.";
  }
  return null;
}
