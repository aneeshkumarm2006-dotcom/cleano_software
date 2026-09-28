// POST /api/v1/documents/:id/sign — sign a document assigned to the caller.
// The version and hash on screen are echoed and must still be current; the
// server draws the strokes into the stored image. Idempotent on clientEventId;
// a replay reads the document again rather than returning stored links.
import { DocumentDetail, SignDocumentRequest } from "@bookmops/api/v1";

import { documentDetailFor, signDocumentFor } from "@/server/documents/documents";
import { revalidateAfterSign } from "@/server/documents/revalidate";
import { pathId, v1Route } from "@/server/v1/route";

export const dynamic = "force-dynamic";

export const POST = v1Route(
  {
    host: "tenant",
    access: "staff",
    body: SignDocumentRequest,
    response: DocumentDetail,
    idempotent: true,
    // 10,000 points of strokes is more than the default 64 KB.
    maxBodyBytes: 384 * 1024,
    limit: { name: "document-sign", max: 20, windowMs: 60 * 60_000 },
    // The answer carries short-lived signed links: the idempotency record
    // keeps the document's id, and a replay reads the document afresh.
    replay: {
      ref: (answer: DocumentDetail) => ({ documentId: answer.id }),
      reread: (ctx, ref) => documentDetailFor(ctx.actor, String(ref.documentId)),
    },
  },
  async (ctx) => {
    const documentId = pathId(ctx.params.id);
    const res = await signDocumentFor(ctx.actor, {
      documentId,
      version: ctx.body.version,
      contentSha256: ctx.body.contentSha256,
      agreed: ctx.body.agreed,
      signature: ctx.body.signature,
      ip: ctx.ip === "unknown" ? null : ctx.ip,
      userAgent: ctx.req.headers.get("user-agent"),
      now: ctx.receivedAt,
    });
    if (res.ok) revalidateAfterSign(documentId);
    return res;
  },
);
