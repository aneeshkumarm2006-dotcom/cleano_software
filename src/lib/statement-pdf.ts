/**
 * Monthly client statement PDF. Lists every booking in the period plus
 * a running totals block. Uses @react-pdf/renderer (already a dep).
 */

const BRAND = "#008C9C";

export interface StatementBookingRow {
  jobNumber: number;
  jobDate: string;
  serviceType: string | null;
  amount: number;
  paid: boolean;
}

export interface StatementData {
  clientName: string;
  monthLabel: string;
  periodStart: string;
  periodEnd: string;
  bookings: StatementBookingRow[];
  totalBilled: number;
  totalPaid: number;
  totalOutstanding: number;
}

export async function buildStatementPdfBuffer(
  data: StatementData
): Promise<Buffer> {
  const { pdf, Document, Page, Text, View, StyleSheet } = await import(
    "@react-pdf/renderer"
  );
  const React = await import("react");
  const tint = (a: number) => `rgba(0,140,156, ${a})`;

  const styles = StyleSheet.create({
    page: {
      paddingTop: 48,
      paddingBottom: 48,
      paddingHorizontal: 48,
      fontSize: 10,
      fontFamily: "Helvetica",
      color: BRAND,
    },
    headerRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
      marginBottom: 24,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: tint(0.2),
    },
    brand: { fontSize: 24, color: BRAND, fontFamily: "Helvetica-Bold" },
    subtitle: { fontSize: 9, color: tint(0.6), marginTop: 2 },
    title: { fontSize: 16, color: BRAND, textAlign: "right" },
    sectionTitle: {
      fontSize: 9,
      color: tint(0.6),
      textTransform: "uppercase",
      marginBottom: 6,
    },
    block: { marginBottom: 18 },
    label: { color: tint(0.6), fontSize: 9, marginBottom: 2 },
    value: { color: BRAND, fontSize: 11 },
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
    footer: {
      marginTop: 36,
      paddingTop: 16,
      borderTopWidth: 0.5,
      borderTopColor: tint(0.2),
      fontSize: 8,
      color: tint(0.5),
      textAlign: "center",
    },
  });

  const fmt = (n: number) => `$${n.toFixed(2)} CAD`;

  const el = React.createElement;

  const doc = el(
    Document,
    null,
    el(
      Page,
      { size: "LETTER", style: styles.page },
      el(
        View,
        { style: styles.headerRow },
        el(
          View,
          null,
          el(Text, { style: styles.brand }, "Cleano"),
          el(Text, { style: styles.subtitle }, "Monthly statement"),
        ),
        el(
          View,
          { style: { alignItems: "flex-end" } },
          el(Text, { style: styles.title }, data.monthLabel),
          el(Text, { style: styles.subtitle }, data.clientName),
        ),
      ),

      el(
        View,
        { style: styles.block },
        el(Text, { style: styles.sectionTitle }, "Period"),
        el(
          Text,
          { style: styles.value },
          `${data.periodStart} – ${data.periodEnd}`,
        ),
      ),

      el(Text, { style: styles.sectionTitle }, "Bookings"),
      el(
        View,
        { style: styles.tableHeader },
        el(Text, { style: [styles.th, { flex: 0.8 }] }, "Booking"),
        el(Text, { style: [styles.th, { flex: 1.4 }] }, "Date"),
        el(Text, { style: [styles.th, { flex: 1.4 }] }, "Service"),
        el(Text, { style: [styles.th, { flex: 0.8, textAlign: "right" }] }, "Status"),
        el(Text, { style: [styles.th, { flex: 1, textAlign: "right" }] }, "Amount"),
      ),
      ...data.bookings.map((b) =>
        el(
          View,
          { style: styles.row, key: `r${b.jobNumber}` },
          el(Text, { style: [styles.cell, { flex: 0.8 }] }, `#${b.jobNumber}`),
          el(
            Text,
            { style: [styles.cell, { flex: 1.4 }] },
            new Date(b.jobDate).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            }),
          ),
          el(Text, { style: [styles.cell, { flex: 1.4 }] }, b.serviceType ?? "—"),
          el(
            Text,
            { style: [styles.cell, { flex: 0.8, textAlign: "right" }] },
            b.paid ? "Paid" : "Outstanding",
          ),
          el(
            Text,
            { style: [styles.cell, { flex: 1, textAlign: "right" }] },
            fmt(b.amount),
          ),
        ),
      ),

      el(
        View,
        { style: styles.totalRow },
        el(Text, { style: styles.totalLabel }, "Total billed"),
        el(Text, { style: styles.totalValue }, fmt(data.totalBilled)),
      ),
      el(
        View,
        { style: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 } },
        el(Text, { style: styles.value }, "Total paid"),
        el(Text, { style: styles.value }, fmt(data.totalPaid)),
      ),
      el(
        View,
        { style: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 } },
        el(Text, { style: styles.value }, "Outstanding"),
        el(Text, { style: styles.value }, fmt(data.totalOutstanding)),
      ),

      el(
        Text,
        { style: styles.footer },
        "Thank you for choosing Cleano. Questions about this statement? Reply to this email.",
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
