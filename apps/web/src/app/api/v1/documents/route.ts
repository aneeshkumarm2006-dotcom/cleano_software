// GET /api/v1/documents — every document assigned to the caller, and their
// void cheque's metadata (never the file).
import { DocumentsListResponse } from "@bookmops/api/v1";

import { listDocumentsFor } from "@/server/documents/documents";
import { v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: DocumentsListResponse }, (ctx) =>
  listDocumentsFor(ctx.actor),
);
