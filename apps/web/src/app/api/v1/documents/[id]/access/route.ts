// POST /api/v1/documents/:id/access — the caller opened or downloaded a
// document assigned to them. Best effort: a failed write is { logged: false }.
import { DocumentAccessRequest, DocumentAccessResponse } from "@bookmops/api/v1";

import { logDocumentAccessFor } from "@/server/documents/documents";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: "staff",
    body: DocumentAccessRequest,
    response: DocumentAccessResponse,
    limit: { name: "document-access", max: 30, windowMs: 60_000 },
  },
  (ctx) => logDocumentAccessFor(ctx.actor, pathId(ctx.params.id), ctx.body.action),
);
