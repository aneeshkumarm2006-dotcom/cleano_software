import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { db } from "@/db";
import DocumentSigningView from "./DocumentSigningView";

export default async function DocumentSigningPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/sign-in");
  }

  const employeeId = session.user.id;

  const signature = await db.documentSignature.findUnique({
    where: {
      documentId_employeeId: {
        documentId: id,
        employeeId,
      },
    },
    include: {
      document: true,
    },
  });

  if (!signature) {
    notFound();
  }

  // Item 20: record the open in the document access log (best-effort — a
  // logging hiccup must never block the signing view).
  await db.documentAccessLog
    .create({
      data: { documentId: id, userId: employeeId, action: "OPEN" },
    })
    .catch((e) => console.error("document access log", e));

  return (
    <div className="h-full overflow-hidden overflow-y-auto p-8">
      <DocumentSigningView
        document={{
          id: signature.document.id,
          title: signature.document.title,
          description: signature.document.description,
          content: signature.document.content,
          fileUrl: signature.document.fileUrl,
          version: signature.document.version,
          dueDate: signature.document.dueDate?.toISOString() ?? null,
        }}
        signature={{
          status: signature.status,
          signedAt: signature.signedAt?.toISOString() ?? null,
          signatureUrl: signature.signatureUrl,
        }}
        signer={{
          name: session.user.name,
        }}
      />
    </div>
  );
}
