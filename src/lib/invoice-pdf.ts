/**
 * Invoice PDF generator. Mirrors the receipt-pdf shape but renders a
 * full invoice with bill-to, line items, GST/QST breakdown, total, and
 * the company tax IDs.
 */

import { db } from "@/db";

const BRAND = "#005F6A";

export interface InvoicePdfData {
  invoiceNumber: string;
  status: string;
  issuedAt: string;
  dueDate: string | null;
  client: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
  subtotal: number;
  discountAmount: number;
  gstAmount: number;
  qstAmount: number;
  totalAmount: number;
  notes: string | null;
  brand: {
    name: string;
    tagline: string;
    gstNumber: string;
    qstNumber: string;
  };
}

export async function loadInvoiceData(
  invoiceId: string
): Promise<InvoicePdfData | null> {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      client: true,
      lineItems: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!invoice) return null;

  const gstSetting = await db.appSetting
    .findUnique({ where: { key: "gstNumber" } })
    .catch(() => null);
  const qstSetting = await db.appSetting
    .findUnique({ where: { key: "qstNumber" } })
    .catch(() => null);
  const gstNumber =
    typeof gstSetting?.value === "string" ? gstSetting.value : "";
  const qstNumber =
    typeof qstSetting?.value === "string" ? qstSetting.value : "";

  return {
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    issuedAt: invoice.createdAt.toISOString(),
    dueDate: invoice.dueDate?.toISOString() ?? null,
    client: {
      name: invoice.client.name,
      email: invoice.client.email,
      phone: invoice.client.phone,
      address: invoice.client.address,
    },
    lineItems: invoice.lineItems.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      amount: li.amount,
    })),
    subtotal: invoice.subtotal,
    discountAmount: invoice.discountAmount,
    gstAmount: invoice.gstAmount,
    qstAmount: invoice.qstAmount,
    totalAmount: invoice.totalAmount,
    notes: invoice.notes,
    brand: {
      name: "Cleano",
      tagline: "Professional Cleaning Services",
      gstNumber,
      qstNumber,
    },
  };
}

export async function buildInvoicePdfBuffer(
  data: InvoicePdfData
): Promise<Buffer> {
  const { pdf, Document, Page, Text, View, StyleSheet } = await import(
    "@react-pdf/renderer"
  );
  const React = await import("react");
  const tint = (a: number) => `rgba(0, 95, 106, ${a})`;

  const styles = StyleSheet.create({
    page: {
      paddingTop: 48,
      paddingBottom: 48,
      paddingHorizontal: 48,
      fontSize: 10,
      fontFamily: "Helvetica",
      color: BRAND,
    },
    headerBand: {
      backgroundColor: BRAND,
      color: "#fff",
      padding: 24,
      flexDirection: "row",
      justifyContent: "space-between",
      borderRadius: 4,
      marginBottom: 24,
    },
    headerLeftTitle: { color: "#fff", fontSize: 22, fontFamily: "Helvetica-Bold" },
    headerLeftSub: { color: "#cfe4e7", fontSize: 9, marginTop: 4 },
    headerRightTitle: { color: "#fff", fontSize: 16, fontFamily: "Helvetica-Bold", textAlign: "right" },
    headerRightSub: { color: "#cfe4e7", fontSize: 8.5, textAlign: "right", marginTop: 2 },
    block: { marginBottom: 18 },
    label: { color: tint(0.6), fontSize: 9, marginBottom: 2 },
    value: { color: BRAND, fontSize: 11 },
    twoColRow: { flexDirection: "row", justifyContent: "space-between" },
    colHalf: { width: "48%" },
    sectionTitle: {
      fontSize: 9,
      color: tint(0.6),
      textTransform: "uppercase",
      marginBottom: 6,
      letterSpacing: 1,
    },
    tableHeader: {
      flexDirection: "row",
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: BRAND,
      marginTop: 8,
    },
    th: { color: tint(0.6), fontSize: 9, textTransform: "uppercase" },
    row: {
      flexDirection: "row",
      paddingVertical: 5,
      borderBottomWidth: 0.5,
      borderBottomColor: tint(0.12),
    },
    cell: { color: BRAND, fontSize: 10 },
    totalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 6,
      marginTop: 6,
      borderTopWidth: 1,
      borderTopColor: BRAND,
    },
    totalLabel: { fontSize: 12, color: BRAND, fontFamily: "Helvetica-Bold" },
    totalValue: { fontSize: 12, color: BRAND, fontFamily: "Helvetica-Bold" },
    notes: {
      marginTop: 18,
      padding: 12,
      backgroundColor: tint(0.05),
      borderRadius: 4,
      fontSize: 10,
      color: tint(0.7),
    },
    footer: {
      marginTop: 30,
      paddingTop: 14,
      borderTopWidth: 0.5,
      borderTopColor: tint(0.2),
      fontSize: 8,
      color: tint(0.5),
      textAlign: "center",
    },
  });

  const fmt = (n: number) => `$${n.toFixed(2)} CAD`;
  const el = React.createElement;

  const fmtDay = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : "—";

  const doc = el(
    Document,
    null,
    el(
      Page,
      { size: "LETTER", style: styles.page },
      el(
        View,
        { style: styles.headerBand },
        el(
          View,
          null,
          el(Text, { style: styles.headerLeftTitle }, "INVOICE"),
          el(Text, { style: styles.headerLeftSub }, data.invoiceNumber),
        ),
        el(
          View,
          null,
          el(Text, { style: styles.headerRightTitle }, data.brand.name),
          el(Text, { style: styles.headerRightSub }, data.brand.tagline),
          ...(data.brand.gstNumber
            ? [el(Text, { style: styles.headerRightSub }, `GST: ${data.brand.gstNumber}`)]
            : []),
          ...(data.brand.qstNumber
            ? [el(Text, { style: styles.headerRightSub }, `QST: ${data.brand.qstNumber}`)]
            : []),
        ),
      ),

      el(
        View,
        { style: [styles.block, styles.twoColRow] },
        el(
          View,
          { style: styles.colHalf },
          el(Text, { style: styles.sectionTitle }, "Bill to"),
          el(Text, { style: styles.value }, data.client.name),
          ...(data.client.address
            ? [el(Text, { style: [styles.value, { fontSize: 10 }] }, data.client.address)]
            : []),
          ...(data.client.email
            ? [el(Text, { style: [styles.value, { fontSize: 10 }] }, data.client.email)]
            : []),
          ...(data.client.phone
            ? [el(Text, { style: [styles.value, { fontSize: 10 }] }, data.client.phone)]
            : []),
        ),
        el(
          View,
          { style: [styles.colHalf, { alignItems: "flex-end" }] },
          el(Text, { style: styles.sectionTitle }, "Date issued"),
          el(Text, { style: styles.value }, fmtDay(data.issuedAt)),
          el(Text, { style: [styles.sectionTitle, { marginTop: 10 }] }, "Due date"),
          el(Text, { style: styles.value }, fmtDay(data.dueDate)),
        ),
      ),

      el(
        View,
        { style: styles.tableHeader },
        el(Text, { style: [styles.th, { flex: 3.4 }] }, "Description"),
        el(Text, { style: [styles.th, { flex: 0.6, textAlign: "right" }] }, "Qty"),
        el(Text, { style: [styles.th, { flex: 1, textAlign: "right" }] }, "Unit"),
        el(Text, { style: [styles.th, { flex: 1, textAlign: "right" }] }, "Amount"),
      ),
      ...data.lineItems.map((li, idx) =>
        el(
          View,
          { style: styles.row, key: `li${idx}` },
          el(Text, { style: [styles.cell, { flex: 3.4 }] }, li.description),
          el(Text, { style: [styles.cell, { flex: 0.6, textAlign: "right" }] }, String(li.quantity)),
          el(Text, { style: [styles.cell, { flex: 1, textAlign: "right" }] }, fmt(li.unitPrice)),
          el(Text, { style: [styles.cell, { flex: 1, textAlign: "right" }] }, fmt(li.amount)),
        ),
      ),

      el(
        View,
        { style: [{ marginTop: 14 }] },
        el(
          View,
          { style: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 } },
          el(Text, { style: styles.value }, "Subtotal"),
          el(Text, { style: styles.value }, fmt(data.subtotal)),
        ),
        ...(data.discountAmount > 0
          ? [
              el(
                View,
                { style: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 } },
                el(Text, { style: styles.value }, "Discount"),
                el(Text, { style: styles.value }, `-${fmt(data.discountAmount)}`),
              ),
            ]
          : []),
        ...(data.gstAmount > 0
          ? [
              el(
                View,
                { style: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 } },
                el(Text, { style: styles.value }, "GST"),
                el(Text, { style: styles.value }, fmt(data.gstAmount)),
              ),
            ]
          : []),
        ...(data.qstAmount > 0
          ? [
              el(
                View,
                { style: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 } },
                el(Text, { style: styles.value }, "QST"),
                el(Text, { style: styles.value }, fmt(data.qstAmount)),
              ),
            ]
          : []),
        el(
          View,
          { style: styles.totalRow },
          el(Text, { style: styles.totalLabel }, "Total"),
          el(Text, { style: styles.totalValue }, fmt(data.totalAmount)),
        ),
      ),

      ...(data.notes
        ? [el(View, { style: styles.notes }, el(Text, null, data.notes))]
        : []),

      el(
        Text,
        { style: styles.footer },
        `Thank you for choosing ${data.brand.name}. Questions? Reply to this email.`,
      ),
    ),
  );

  const stream = await pdf(doc).toBuffer();
  return await streamToBuffer(stream);
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
