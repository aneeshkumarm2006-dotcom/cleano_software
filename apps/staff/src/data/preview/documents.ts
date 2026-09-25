// Sample documents for development builds: two to sign (one with text, one
// the office gave no text for), one signed, one withdrawn. Signing sticks.
import type { DocumentDetail } from "@bookmops/api/v1";
import { ApiError } from "@bookmops/api/client";

import type { DataSource } from "../source";
import { delay } from "./delay";
import { once } from "./replay";

const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const CHEMICAL_POLICY = `Section 1 — Storing chemicals in the van

Every bottle travels in the labelled caddy. Nothing is carried loose in the footwell or the boot, including part-used bottles you intend to finish the same day.

Descaler and oven cleaner are never stored next to each other. If the caddy dividers are damaged, report it in the app and collect a replacement before your next shift.

Section 2 — In the customer's home

Open a window before using any product in a bathroom. Never mix two products in the same cloth or bucket, even when both are ours.

Section 3 — Spills and splashes

Rinse skin or eyes with clean water for at least fifteen minutes, then call the office. Keep the bottle so the office can read the label to a pharmacist or to Info-Santé 811.`;

let docs: DocumentDetail[] = [
  {
    id: "d-chem",
    title: "Chemical handling policy",
    description: "How products are stored, carried and used.",
    version: "3",
    dueAt: daysFromNow(5),
    publishedAt: daysFromNow(-6),
    status: "PENDING",
    signedAt: null,
    hasFile: false,
    content: CHEMICAL_POLICY,
    fileUrl: null,
  },
  {
    id: "d-keys",
    title: "Key and alarm code agreement",
    description: "Keeping customers' keys and codes safe.",
    version: "1.0",
    dueAt: daysFromNow(-2),
    publishedAt: daysFromNow(-20),
    status: "PENDING",
    signedAt: null,
    hasFile: false,
    content: null,
    fileUrl: null,
  },
  {
    id: "d-conduct",
    title: "Code of conduct",
    description: null,
    version: "2",
    dueAt: null,
    publishedAt: daysFromNow(-90),
    status: "SIGNED",
    signedAt: daysFromNow(-84),
    hasFile: true,
    content: null,
    fileUrl: "https://example.com/documents/code-of-conduct-v2.pdf",
  },
  {
    id: "d-old",
    title: "Holiday schedule 2025",
    description: null,
    version: "1.0",
    dueAt: null,
    publishedAt: daysFromNow(-300),
    status: "REVOKED",
    signedAt: null,
    hasFile: false,
    content: "Replaced by the 2026 schedule.",
    fileUrl: null,
  },
];

function find(id: string): DocumentDetail {
  const d = docs.find((x) => x.id === id);
  if (!d) throw new ApiError("This document isn't available.", 404, "NOT_FOUND", false);
  return d;
}

export const previewDocumentsApi = {
  documents: () =>
    delay({
      items: docs.map(({ content: _c, fileUrl: _f, ...summary }) => summary),
      voidCheque: { fileName: "cheque-desjardins.pdf", mimeType: "application/pdf", uploadedAt: daysFromNow(-40) },
    }),
  document: (id) => {
    try {
      return delay(find(id));
    } catch (e) {
      return Promise.reject(e);
    }
  },
  logDocumentAccess: () => delay({ logged: true }, 100),
  signDocument: (id, body) =>
    once(body.clientEventId, () => {
      const d = find(id);
      if (d.status === "SIGNED") throw new ApiError("You've already signed this document.", 409, "ALREADY_SIGNED", false);
      if (d.status !== "PENDING") throw new ApiError("This document can no longer be signed.", 409, "NOT_SIGNABLE", false);
      const signed: DocumentDetail = { ...d, status: "SIGNED", signedAt: new Date().toISOString() };
      docs = docs.map((x) => (x.id === id ? signed : x));
      return signed;
    }, 900),
} satisfies Pick<DataSource, "documents" | "document" | "logDocumentAccess" | "signDocument">;
