import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { loadReceiptData, buildReceiptPdfBuffer } from "@/lib/receipt-pdf";

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  const isStaff = role === "OWNER" || role === "ADMIN";

  const { jobId } = await ctx.params;
  const data = await loadReceiptData(jobId);
  if (!data) {
    return new NextResponse("Job not found", { status: 404 });
  }

  // Customers may download the receipt for a job that belongs to them.
  if (!isStaff) {
    const userEmail = session.user.email?.toLowerCase();
    const ownerEmail = data.clientEmail?.toLowerCase();
    if (!userEmail || !ownerEmail || userEmail !== ownerEmail) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  const buffer = await buildReceiptPdfBuffer(data);

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="cleano-receipt-${data.jobNumber}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
