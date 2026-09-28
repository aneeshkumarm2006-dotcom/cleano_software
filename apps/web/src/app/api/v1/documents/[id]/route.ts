// GET /api/v1/documents/:id — one document assigned to the caller, with the
// hash of what it shows. A file is sent only as a short-lived signed link on
// the company's own storage. Reading does not log an open (see /access).
import { DocumentDetail } from "@bookmops/api/v1";

import { documentDetailFor } from "@/server/documents/documents";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const GET = v1Route({ host: "tenant", access: "staff", response: DocumentDetail }, (ctx) =>
  documentDetailFor(ctx.actor, pathId(ctx.params.id)),
);
