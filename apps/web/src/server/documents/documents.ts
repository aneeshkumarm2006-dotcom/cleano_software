// Documents: what the office has assigned a person to read and sign, and the
// void cheque they keep on file (packages/api/src/v1/documents.ts).
//
// A document is reachable only through the caller's OWN signature row
// (DocumentSignature, unique per document and employee). Every function here
// looks it up by (documentId, actor.userId) through the organization-scoped
// client, so a document assigned to someone else, or in another company, is
// the same 404 as one that doesn't exist.
//
// Both front doors use this: the web's signDocument / logDocumentAccess /
// getMyVoidCheque actions and document page, and /api/v1/documents/*.
import "server-only";

import { createHash } from "node:crypto";

import { DrawnSignature } from "@bookmops/api/v1";
import type { UploadApiResponse } from "cloudinary";

import { currentOrgSlug, orgAssetFolder } from "@/lib/asset-folder";
import { cloudinary, cloudinaryConfigured } from "@/lib/cloudinary";
import { sendAdminDocSigned } from "@/lib/email";
import { VOID_CHEQUE_KIND } from "@/lib/employee-files";
import { db } from "@/lib/org-db";

import type { Actor } from "../actor";
import { effect } from "../effects";
import { failure, notFound, ok, type Result } from "../result";
import { cloudName, fetchCompanyFileBytes, signCompanyFile } from "../storage/company-file-sign";
import { parseCompanyFileUrl, type CompanyFile } from "../storage/company-file-url";
import { MAX_RENDER_INK, renderInk, renderSignaturePng } from "./signature-png";

// ── Views ───────────────────────────────────────────────────────────────────

export interface DocumentSummaryView {
  id: string;
  title: string;
  description: string | null;
  version: string;
  dueAt: string | null;
  publishedAt: string;
  status: string;
  signedAt: string | null;
  hasFile: boolean;
}

export interface DocumentDetailView extends DocumentSummaryView {
  content: string | null;
  fileUrl: string | null;
  contentSha256: string;
}

export interface VoidChequeView {
  fileName: string;
  mimeType: string;
  uploadedAt: string;
}

const DOC_SELECT = {
  id: true,
  title: true,
  description: true,
  content: true,
  fileUrl: true,
  version: true,
  dueDate: true,
  createdAt: true,
  contentSha256: true,
  contentSha256Basis: true,
} as const;

type DocRow = {
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  fileUrl: string | null;
  version: string;
  dueDate: Date | null;
  createdAt: Date;
  contentSha256: string | null;
  contentSha256Basis: string | null;
};

function summary(doc: DocRow, sig: { status: string; signedAt: Date | null }): DocumentSummaryView {
  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
    version: doc.version,
    dueAt: doc.dueDate?.toISOString() ?? null,
    publishedAt: doc.createdAt.toISOString(),
    status: sig.status,
    signedAt: sig.signedAt?.toISOString() ?? null,
    hasFile: !!doc.fileUrl,
  };
}

// ── What a version shows, and its hash ──────────────────────────────────────

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

export interface Fingerprint {
  contentSha256: string;
  /** The file on the company's storage, when the document is one. */
  file: CompanyFile | null;
}

/**
 * SHA-256 of exactly what this version shows:
 *   - a file on the company's own storage: its bytes (worked out once and
 *     kept, keyed on the URL, so a replaced file is hashed again);
 *   - a file linked from anywhere else, which is never fetched (so never an
 *     outbound request to a URL someone typed): the link itself, which is
 *     what the web shows and what identifies that version;
 *   - text: the text as UTF-8, exactly as sent;
 *   - neither: the title, version and description the acknowledgement is
 *     built from.
 * Worked out at publish (createDocument) and checked again on every read and
 * sign, so a document changed underneath a signer is noticed.
 */
export async function documentFingerprint(doc: DocRow): Promise<Fingerprint> {
  let basis: string;
  let hash: string | null = null;
  let file: CompanyFile | null = null;

  if (doc.fileUrl) {
    file = cloudinaryConfigured()
      ? parseCompanyFileUrl(doc.fileUrl, { cloudName: cloudName(), orgSlug: await currentOrgSlug() })
      : null;
    if (file) {
      basis = `file:${doc.fileUrl}`;
      if (doc.contentSha256Basis === basis && doc.contentSha256) hash = doc.contentSha256;
      else hash = sha256(await fetchCompanyFileBytes(file));
    } else {
      basis = `file-ref:${doc.fileUrl}`;
      hash = sha256(`file-ref\n${doc.fileUrl}`);
    }
  } else if (doc.content) {
    basis = "content";
    hash = sha256(Buffer.from(doc.content, "utf8"));
  } else {
    basis = "summary";
    hash = sha256(`${doc.title}\n${doc.version}\n${doc.description ?? ""}`);
  }

  if (doc.contentSha256 !== hash || doc.contentSha256Basis !== basis) {
    // Kept for the record; best effort, since the value is recomputable.
    await db.document
      .updateMany({ where: { id: doc.id }, data: { contentSha256: hash, contentSha256Basis: basis } })
      .catch((e) => console.error("document hash store", e));
  }
  return { contentSha256: hash, file };
}

/** Work out and keep a new document's hash. Best effort: a read does it again. */
export async function fingerprintNewDocument(documentId: string): Promise<void> {
  const doc = await db.document.findFirst({ where: { id: documentId }, select: DOC_SELECT });
  if (doc) await documentFingerprint(doc);
}

/** The consent sentence, as the web and the app show it beside the tick box. */
export function consentSentence(title: string): string {
  return `I have read and agree to the terms set out in ${title}, and I am signing this document electronically.`;
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** Every document assigned to the caller, newest assignment first, with their void cheque. */
export async function listDocumentsFor(
  actor: Actor,
): Promise<Result<{ items: DocumentSummaryView[]; voidCheque: VoidChequeView | null }>> {
  const rows = await db.documentSignature.findMany({
    where: { employeeId: actor.userId },
    orderBy: [{ createdAt: "desc" }],
    select: { status: true, signedAt: true, document: { select: DOC_SELECT } },
  });
  return ok({
    items: rows.map((r) => summary(r.document, r)),
    voidCheque: await myVoidCheque(actor),
  });
}

/**
 * The caller's current void cheque: METADATA ONLY (awerfixes.pdf item 16,
 * decision 7). Viewing the file is an owner/admin action that mints a signed
 * URL and logs it; this never hands out a second, unlogged path to it.
 */
export async function myVoidCheque(actor: Actor): Promise<VoidChequeView | null> {
  const row = await db.employeeFile.findFirst({
    where: { employeeId: actor.userId, kind: VOID_CHEQUE_KIND },
    // Newest row is the current one: the table is append-only.
    orderBy: { uploadedAt: "desc" },
    select: { fileName: true, mimeType: true, uploadedAt: true },
  });
  if (!row) return null;
  return { fileName: row.fileName, mimeType: row.mimeType, uploadedAt: row.uploadedAt.toISOString() };
}

async function ownRow(actor: Actor, documentId: string) {
  return db.documentSignature.findUnique({
    where: { documentId_employeeId: { documentId, employeeId: actor.userId } },
    select: { id: true, status: true, signedAt: true, document: { select: DOC_SELECT } },
  });
}

async function detailOf(
  doc: DocRow,
  sig: { status: string; signedAt: Date | null },
): Promise<DocumentDetailView> {
  const fp = await documentFingerprint(doc);
  return {
    ...summary(doc, sig),
    content: doc.content,
    // Only the company's own storage, as a link made for this response.
    fileUrl: fp.file ? signCompanyFile(fp.file) : null,
    contentSha256: fp.contentSha256,
  };
}

/** One assigned document, to read and sign. Does not log an open. */
export async function documentDetailFor(actor: Actor, documentId: string): Promise<Result<DocumentDetailView>> {
  const row = await ownRow(actor, documentId);
  if (!row) return notFound("This document isn't available.");
  return ok(await detailOf(row.document, row));
}

export const DOCUMENT_ACCESS_ACTIONS = ["OPEN", "VIEW", "DOWNLOAD"] as const;
export type DocumentAccessAction = (typeof DOCUMENT_ACCESS_ACTIONS)[number];

/**
 * Record that the caller opened or downloaded a document assigned to them.
 * Best effort: a failed write is `logged: false`, never an error. COMPLETE is
 * written only by signing.
 */
export async function logDocumentAccessFor(
  actor: Actor,
  documentId: string,
  action: DocumentAccessAction,
): Promise<Result<{ logged: boolean }>> {
  if (!(DOCUMENT_ACCESS_ACTIONS as readonly string[]).includes(action)) {
    return failure(400, "VALIDATION_FAILED", "Something in that request wasn't right.");
  }
  const row = await db.documentSignature.findUnique({
    where: { documentId_employeeId: { documentId, employeeId: actor.userId } },
    select: { id: true },
  });
  if (!row) return notFound("This document isn't available.");
  try {
    await db.documentAccessLog.create({ data: { documentId, userId: actor.userId, action } });
    return ok({ logged: true });
  } catch (e) {
    console.error("document access log", e);
    return ok({ logged: false });
  }
}

// ── Signing ─────────────────────────────────────────────────────────────────

export interface SignDocumentInput {
  documentId: string;
  /** Echoed from what was on screen. */
  version: string;
  contentSha256: string;
  agreed: boolean;
  /** The strokes, as DrawnSignature. Validated here as well as at the edge. */
  signature: unknown;
  ip: string | null;
  userAgent: string | null;
  now: Date;
}

const MESSAGES = {
  notAssigned: "This document is not assigned to you",
  alreadySigned: "Document already signed",
  revoked: "Document has been revoked",
  expired: "Document has expired",
  changed: "This document has changed since you opened it. Read the new version, then sign.",
  agree: "Tick the box to confirm you've read and agree to it.",
  noSignature: "A signature is required",
  storeFailed: "Failed to store signature image",
} as const;

function signatureProblem(raw: unknown): { ok: true; value: DrawnSignature } | { ok: false; message: string } {
  const parsed = DrawnSignature.safeParse(raw);
  if (!parsed.success) {
    const custom = parsed.error.issues.find((i) => i.code === "custom")?.message;
    return { ok: false, message: custom ?? MESSAGES.noSignature };
  }
  const sig = parsed.data;
  // Every point inside THIS pad, not just inside the largest one allowed.
  for (const stroke of sig.strokes) {
    for (const [x, y] of stroke) {
      if (x > sig.width || y > sig.height) return { ok: false, message: "Sign inside the box." };
    }
  }
  if (renderInk(sig) > MAX_RENDER_INK) {
    return { ok: false, message: "That signature is too long. Clear it and sign again." };
  }
  return { ok: true, value: sig };
}

function uploadPng(png: Buffer, folder: string, publicId: string): Promise<UploadApiResponse> {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload(
      `data:image/png;base64,${png.toString("base64")}`,
      { folder, public_id: publicId, resource_type: "image", overwrite: false },
      (error, result) => (error || !result ? reject(error || new Error("Upload failed")) : resolve(result)),
    );
  });
}

/**
 * Sign an assigned document.
 *
 *   - the caller's own signature row, else 404;
 *   - PENDING only: SIGNED is 409 ALREADY_SIGNED, REVOKED / EXPIRED 409
 *     NOT_SIGNABLE;
 *   - the echoed version and contentSha256 must be the document's current
 *     ones, else 409 DOCUMENT_CHANGED;
 *   - `agreed` must be true;
 *   - the strokes are validated and drawn HERE into the stored PNG: no image
 *     or markup from the client is ever stored;
 *   - kept with it: server time, version, hash, the server's own consent
 *     sentence, IP and User-Agent; then a COMPLETE access row, and the
 *     office's "document signed" email as an effect.
 *
 * The status change is conditional on the row still being PENDING, so two
 * signs at once apply once; the loser is ALREADY_SIGNED.
 */
export async function signDocumentFor(actor: Actor, input: SignDocumentInput): Promise<Result<DocumentDetailView>> {
  const row = await ownRow(actor, input.documentId);
  if (!row) return notFound(MESSAGES.notAssigned);
  if (row.status === "SIGNED") return failure(409, "ALREADY_SIGNED", MESSAGES.alreadySigned);
  if (row.status === "REVOKED") return failure(409, "NOT_SIGNABLE", MESSAGES.revoked);
  if (row.status !== "PENDING") return failure(409, "NOT_SIGNABLE", MESSAGES.expired);

  if (input.agreed !== true) return failure(400, "VALIDATION_FAILED", MESSAGES.agree);
  const sig = signatureProblem(input.signature);
  if (!sig.ok) return failure(400, "VALIDATION_FAILED", sig.message);

  const doc = row.document;
  const fp = await documentFingerprint(doc);
  if (input.version !== doc.version || input.contentSha256 !== fp.contentSha256) {
    return failure(409, "DOCUMENT_CHANGED", MESSAGES.changed);
  }

  const png = renderSignaturePng(sig.value);
  let signatureUrl: string;
  if (cloudinaryConfigured()) {
    try {
      const folder = await orgAssetFolder("signatures", doc.id);
      const result = await uploadPng(png, folder, `${actor.userId}-${input.now.getTime()}`);
      signatureUrl = result.secure_url;
    } catch (err) {
      console.error("Signature upload failed:", err);
      return failure(409, "STORE_FAILED", MESSAGES.storeFailed, true);
    }
  } else {
    // As the web always did without storage configured: kept inline. It is
    // the server's own rendering, never the client's bytes.
    signatureUrl = `data:image/png;base64,${png.toString("base64")}`;
  }

  const signedAt = input.now;
  const claimed = await db.documentSignature.updateMany({
    where: { id: row.id, employeeId: actor.userId, status: "PENDING" },
    data: {
      status: "SIGNED",
      signatureUrl,
      signedAt,
      ipAddress: input.ip?.slice(0, 64) || null,
      userAgent: input.userAgent?.slice(0, 512) || null,
      signedVersion: doc.version,
      signedContentSha256: fp.contentSha256,
      consentText: consentSentence(doc.title),
    },
  });
  if (claimed.count === 0) return failure(409, "ALREADY_SIGNED", MESSAGES.alreadySigned);

  // Signing is completing the document, in the access log (item 20).
  await db.documentAccessLog
    .create({ data: { documentId: doc.id, userId: actor.userId, action: "COMPLETE" } })
    .catch((e) => console.error("document access log", e));

  const detail: DocumentDetailView = {
    ...summary(doc, { status: "SIGNED", signedAt }),
    content: doc.content,
    fileUrl: fp.file ? signCompanyFile(fp.file) : null,
    contentSha256: fp.contentSha256,
  };
  return ok(detail, [
    // Gated by `admin.docs.signed_completed`.
    effect("admin doc-signed", () =>
      sendAdminDocSigned({ signerName: actor.name ?? "Cleaner", documentTitle: doc.title }),
    ),
  ]);
}
