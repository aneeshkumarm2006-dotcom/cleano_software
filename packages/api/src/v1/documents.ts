// Documents: the policies and agreements the office has assigned the cleaner
// to read and sign, and the payroll paperwork they keep on file.
//
// A document is visible to a cleaner only through their OWN signature row
// (DocumentSignature, unique per document and employee). Every route looks the
// document up by (documentId, session user); a document not assigned to the
// caller answers 404, the same as one that doesn't exist.
import { z } from "zod";

import { Instant, openEnum } from "./common";

export const DOCUMENT_STATUSES = ["PENDING", "SIGNED", "EXPIRED", "REVOKED"] as const;

/** A document as the list shows it. `id` is the DOCUMENT's id. */
export const DocumentSummary = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  /** "3", "1.0". Shown as "Version 3". */
  version: z.string(),
  /** When the office wants it signed by. */
  dueAt: Instant.nullable(),
  /** When the document was published. */
  publishedAt: Instant,
  status: openEnum(DOCUMENT_STATUSES),
  signedAt: Instant.nullable(),
  /** The document is a file (a PDF) rather than text on screen. */
  hasFile: z.boolean(),
});
export type DocumentSummary = z.infer<typeof DocumentSummary>;

/** The cleaner's void cheque on record: metadata only, never the file. */
export const VoidChequeOnFile = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  uploadedAt: Instant,
});
export type VoidChequeOnFile = z.infer<typeof VoidChequeOnFile>;

/**
 * GET /api/v1/documents — every document assigned to the caller, newest first.
 *
 * Server: staff only; signature rows WHERE employeeId = session user. The
 * void cheque is the caller's own, metadata only, as `getMyVoidCheque`: no
 * URL to the file, which only an owner or admin can open (and that is logged).
 */
export const DocumentsListResponse = z.object({
  items: z.array(DocumentSummary),
  voidCheque: VoidChequeOnFile.nullable(),
});
export type DocumentsListResponse = z.infer<typeof DocumentsListResponse>;

/**
 * GET /api/v1/documents/:id — one assigned document, to read and sign.
 *
 * Server: 404 unless the caller has a signature row for it. Reading does NOT
 * log access by itself (a refetch is not a new open); the app posts to
 * /access. `content` is plain text: the app shows it as text, never as HTML.
 * `fileUrl` is sent only when it is an https URL; otherwise null.
 */
export const DocumentDetail = DocumentSummary.extend({
  content: z.string().nullable(),
  fileUrl: z.string().nullable(),
});
export type DocumentDetail = z.infer<typeof DocumentDetail>;

export const DOCUMENT_ACCESS_ACTIONS = ["OPEN", "VIEW", "DOWNLOAD"] as const;

/**
 * POST /api/v1/documents/:id/access — record that the caller opened or
 * downloaded the document, as `logDocumentAccess`. Best effort: the app never
 * waits on it or tells the person if it fails. COMPLETE is written by the
 * server when a document is signed, never by the app.
 *
 * Server: 404 unless the caller has a signature row for the document (the
 * web's action doesn't check this; v1 does). Rate-limited per user.
 */
export const DocumentAccessRequest = z.object({ action: z.enum(DOCUMENT_ACCESS_ACTIONS) });
export type DocumentAccessRequest = z.infer<typeof DocumentAccessRequest>;
export const DocumentAccessResponse = z.object({ logged: z.boolean() });

/** A drawn signature's pad, in points. */
export const SIGNATURE_MAX_WIDTH = 2000;
export const SIGNATURE_MAX_HEIGHT = 1000;

/**
 * A drawn signature as the strokes the finger made: numbers only, never an
 * image or markup from the phone. The server draws it (black on white) into
 * the image it stores, so nothing the phone sends is ever served back as a
 * file.
 */
export const DrawnSignature = z.object({
  width: z.number().int().min(100).max(SIGNATURE_MAX_WIDTH),
  height: z.number().int().min(50).max(SIGNATURE_MAX_HEIGHT),
  /** Each stroke is a list of [x, y] points inside the pad. */
  strokes: z
    .array(z.array(z.tuple([z.number(), z.number()])).min(1).max(2000))
    .min(1)
    .max(64),
});
export type DrawnSignature = z.infer<typeof DrawnSignature>;

/**
 * POST /api/v1/documents/:id/sign — sign an assigned document. Idempotent on
 * `clientEventId`: a retry returns the same result.
 *
 * Server, as `signDocument`:
 *   - the caller's own signature row; 404 when there is none;
 *   - status must be PENDING: SIGNED → 409 `ALREADY_SIGNED`, REVOKED or
 *     EXPIRED → 409 `NOT_SIGNABLE`;
 *   - `agreed` must be true — the person ticked "I have read and agree to the
 *     terms set out in {title}, and I am signing this document electronically.";
 *   - every point inside the pad (400 otherwise); renders the strokes to a PNG
 *     and stores it where the web stores signatures;
 *   - records signedAt (server time), the request IP, a COMPLETE access row,
 *     and sends the office's "document signed" email.
 * Returns the document as it now stands.
 */
export const SignDocumentRequest = z.object({
  clientEventId: z.uuid(),
  agreed: z.literal(true),
  signature: DrawnSignature,
});
export type SignDocumentRequest = z.infer<typeof SignDocumentRequest>;
