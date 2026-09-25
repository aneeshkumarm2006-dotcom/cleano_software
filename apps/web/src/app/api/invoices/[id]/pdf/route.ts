import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildInvoicePdfBuffer, loadInvoiceData } from "@/lib/invoice-pdf";

/**
 * Stream the invoice PDF inline so the admin can download or preview it.
 * Requires an OWNER/ADMIN/OPS_MANAGER session.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== "OWNER" && role !== "ADMIN" && role !== "OPS_MANAGER") {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const data = await loadInvoiceData(id);
  if (!data) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const buffer = await buildInvoicePdfBuffer(data);
  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="invoice-${data.invoiceNumber}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
