"use client";

import { useState } from "react";
import { Download, Loader } from "lucide-react";
import Button from "@/components/ui/Button";
import CustomDropdown from "@/components/ui/custom-dropdown";
import Modal from "@/components/ui/Modal";
import DatePicker from "@/components/ui/DatePicker";
import { exportJobs } from "../actions/exportJobs";
import type { JobExportRow } from "../actions/exportJobs.types";

interface ExportButtonProps {
  filters: {
    startDate?: string;
    endDate?: string;
    jobType?: string;
    clientId?: string;
    employeeId?: string;
    paymentType?: string;
    status?: string;
    discountedOnly?: boolean;
    unpaidOnly?: boolean;
    includeArchived?: boolean;
  };
}

const BRAND = "#008C9C";

function formatMoney(v: number | string) {
  if (v === "" || v === null || v === undefined) return "-";
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) return "-";
  return `$${n.toFixed(2)}`;
}

async function buildJobsPdf(
  rows: JobExportRow[],
  generatedAt: string
): Promise<Blob> {
  const { pdf, Document, Page, Text, View, StyleSheet } = await import(
    "@react-pdf/renderer"
  );

  const tint = (alpha: number) => `rgba(0,140,156, ${alpha})`;

  const styles = StyleSheet.create({
    page: {
      paddingTop: 36,
      paddingBottom: 40,
      paddingHorizontal: 32,
      fontSize: 9,
      fontFamily: "Helvetica",
      color: BRAND,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
      marginBottom: 16,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: BRAND,
    },
    title: { fontSize: 20, color: BRAND },
    subtitle: { fontSize: 9, color: tint(0.7), marginTop: 4 },
    brand: { fontSize: 14, color: BRAND, textAlign: "right" },
    metaLine: { fontSize: 9, color: tint(0.7), textAlign: "right" },
    summaryRow: {
      flexDirection: "row",
      marginBottom: 14,
    },
    summaryCard: {
      flex: 1,
      backgroundColor: tint(0.05),
      borderRadius: 10,
      padding: 10,
      marginRight: 8,
    },
    summaryCardLast: {
      marginRight: 0,
    },
    summaryLabel: {
      fontSize: 8,
      letterSpacing: 1,
      color: tint(0.6),
      textTransform: "uppercase",
      marginBottom: 4,
    },
    summaryValue: { fontSize: 14, color: BRAND },
    tableHeader: {
      flexDirection: "row",
      backgroundColor: tint(0.05),
      borderTopLeftRadius: 8,
      borderTopRightRadius: 8,
      paddingVertical: 6,
      paddingHorizontal: 4,
    },
    tableHeaderCell: {
      fontSize: 7,
      color: tint(0.4),
      textTransform: "uppercase",
      letterSpacing: 0.5,
      paddingHorizontal: 3,
    },
    tableRow: {
      flexDirection: "row",
      paddingVertical: 6,
      paddingHorizontal: 4,
      borderBottomWidth: 0.5,
      borderBottomColor: tint(0.08),
    },
    tableRowAlt: {
      backgroundColor: tint(0.02),
    },
    cell: {
      fontSize: 8,
      color: BRAND,
      paddingHorizontal: 3,
    },
    cellMuted: {
      fontSize: 7,
      color: tint(0.5),
      paddingHorizontal: 3,
      marginTop: 1,
    },
    badge: {
      fontSize: 7,
      paddingVertical: 2,
      paddingHorizontal: 5,
      borderRadius: 6,
      alignSelf: "flex-start",
      backgroundColor: tint(0.08),
      color: BRAND,
    },
    footer: {
      position: "absolute",
      bottom: 18,
      left: 32,
      right: 32,
      flexDirection: "row",
      justifyContent: "space-between",
      fontSize: 8,
      color: tint(0.5),
    },
    empty: {
      padding: 24,
      textAlign: "center",
      color: tint(0.5),
      fontSize: 10,
    },
  });

  const cols = {
    date: { flex: 1.1 },
    client: { flex: 2.2 },
    employee: { flex: 1.6 },
    type: { flex: 0.8 },
    status: { flex: 1.3 },
    price: { flex: 1.1, textAlign: "right" as const },
    discount: { flex: 1, textAlign: "right" as const },
    pay: { flex: 1.1, textAlign: "right" as const },
    payment: { flex: 1.3 },
    paid: { flex: 0.8, textAlign: "center" as const },
  };

  const totalRevenue = rows.reduce((sum, r) => {
    const n = typeof r.Price === "number" ? r.Price : Number(r.Price) || 0;
    return sum + n;
  }, 0);
  const completed = rows.filter((r) => r.Status === "COMPLETED").length;
  const unpaid = rows.filter(
    (r) => r["Payment Received"] === "No" && r.Status === "COMPLETED"
  ).length;

  const formatStatus = (s: string) =>
    s
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const doc = (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.title}>Cleaning Jobs</Text>
            <Text style={styles.subtitle}>
              Manage your cleaning jobs and track your revenue
            </Text>
          </View>
          <View>
            <Text style={styles.brand}>Cleano</Text>
            <Text style={styles.metaLine}>Generated {generatedAt}</Text>
          </View>
        </View>

        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Jobs</Text>
            <Text style={styles.summaryValue}>{rows.length}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Completed</Text>
            <Text style={styles.summaryValue}>{completed}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Revenue</Text>
            <Text style={styles.summaryValue}>
              ${totalRevenue.toFixed(2)}
            </Text>
          </View>
          <View style={[styles.summaryCard, styles.summaryCardLast]}>
            <Text style={styles.summaryLabel}>Pending Payment</Text>
            <Text style={styles.summaryValue}>{unpaid}</Text>
          </View>
        </View>

        {rows.length === 0 ? (
          <View style={styles.empty}>
            <Text>No jobs found</Text>
          </View>
        ) : (
          <View>
            <View style={styles.tableHeader} fixed>
              <Text style={[styles.tableHeaderCell, cols.date]}>Date</Text>
              <Text style={[styles.tableHeaderCell, cols.client]}>Client</Text>
              <Text style={[styles.tableHeaderCell, cols.employee]}>
                Cleaners
              </Text>
              <Text style={[styles.tableHeaderCell, cols.type]}>Type</Text>
              <Text style={[styles.tableHeaderCell, cols.status]}>Status</Text>
              <Text style={[styles.tableHeaderCell, cols.price]}>Price</Text>
              <Text style={[styles.tableHeaderCell, cols.discount]}>
                Discount
              </Text>
              <Text style={[styles.tableHeaderCell, cols.pay]}>Pay</Text>
              <Text style={[styles.tableHeaderCell, cols.payment]}>
                Pay Type
              </Text>
              <Text style={[styles.tableHeaderCell, cols.paid]}>Paid</Text>
            </View>

            {rows.map((r, i) => (
              <View
                key={i}
                style={[
                  styles.tableRow,
                  i % 2 === 1 ? styles.tableRowAlt : {},
                ]}
                wrap={false}>
                <View style={cols.date}>
                  <Text style={styles.cell}>{r.Date}</Text>
                </View>
                <View style={cols.client}>
                  <Text style={styles.cell}>{r.Client || "-"}</Text>
                  {r.Location ? (
                    <Text style={styles.cellMuted}>{r.Location}</Text>
                  ) : null}
                </View>
                <View style={cols.employee}>
                  <Text style={styles.cell}>{r.Employee || "-"}</Text>
                </View>
                <View style={cols.type}>
                  <Text style={styles.cell}>{r["Job Type"] || "-"}</Text>
                </View>
                <View style={cols.status}>
                  <Text style={styles.badge}>{formatStatus(r.Status)}</Text>
                </View>
                <Text style={[styles.cell, cols.price]}>
                  {formatMoney(r.Price)}
                </Text>
                <Text style={[styles.cell, cols.discount]}>
                  {r.Discount === "" || r.Discount === 0
                    ? "-"
                    : `−${formatMoney(r.Discount)}`}
                </Text>
                <Text style={[styles.cell, cols.pay]}>
                  {formatMoney(r["Employee Pay"])}
                </Text>
                <View style={cols.payment}>
                  <Text style={styles.cell}>
                    {r["Payment Type"]
                      ? r["Payment Type"].replace(/_/g, " ")
                      : "-"}
                  </Text>
                </View>
                <Text style={[styles.cell, cols.paid]}>
                  {r["Payment Received"]}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>Cleano — Jobs Export</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );

  return await pdf(doc).toBlob();
}

export default function ExportButton({ filters }: ExportButtonProps) {
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingFormat, setPendingFormat] = useState<"csv" | "pdf">("csv");
  const [startDate, setStartDate] = useState(filters.startDate || "");
  const [endDate, setEndDate] = useState(filters.endDate || "");
  const [error, setError] = useState<string | null>(null);

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const openPicker = (format: "csv" | "pdf") => {
    setPendingFormat(format);
    setStartDate(filters.startDate || "");
    setEndDate(filters.endDate || "");
    setError(null);
    setPickerOpen(true);
  };

  const runExport = async () => {
    if (startDate && endDate && startDate > endDate) {
      setError("Start date must be on or before end date.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await exportJobs({
        ...filters,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        format: pendingFormat,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      if (result.format === "csv") {
        const blob = new Blob([result.content], { type: "text/csv" });
        triggerDownload(blob, result.filename);
      } else {
        const blob = await buildJobsPdf(result.rows, result.generatedAt);
        triggerDownload(blob, result.filename);
      }
      setPickerOpen(false);
    } catch (err) {
      console.error(err);
      setError("Failed to export jobs");
    } finally {
      setBusy(false);
    }
  };

  const dateInputClass =
    "h-[42px] w-full px-3 rounded-xl bg-[#008C9C]/5 text-sm text-[#008C9C] border-0 focus:outline-none focus:ring-1 focus:ring-[#008C9C]/20";

  return (
    <>
      <CustomDropdown
        align="right"
        trigger={
          <Button
            variant="default"
            size="md"
            border={false}
            disabled={busy}
            className="h-[42px] px-4 py-3 flex items-center gap-2">
            {busy ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span className="text-sm font-[350]">Export</span>
          </Button>
        }
        options={[
          {
            label: "CSV",
            onClick: () => openPicker("csv"),
          },
          {
            label: "PDF",
            onClick: () => openPicker("pdf"),
          },
        ]}
        maxHeight="12rem"
      />

      <Modal
        isOpen={pickerOpen}
        onClose={() => {
          if (!busy) setPickerOpen(false);
        }}
        title={`Export jobs as ${pendingFormat.toUpperCase()}`}
        subheader="Choose a date range. Leave empty to export all jobs.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
          <div className="flex flex-col">
            <label className="text-[11px] uppercase tracking-wider text-[#008C9C]/50 font-[400] mb-1.5">
              Start Date
            </label>
            <DatePicker
              value={startDate}
              max={endDate || undefined}
              onChange={setStartDate}
              size="sm"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-[11px] uppercase tracking-wider text-[#008C9C]/50 font-[400] mb-1.5">
              End Date
            </label>
            <DatePicker
              value={endDate}
              min={startDate || undefined}
              onChange={setEndDate}
              size="sm"
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 mt-3">{error}</p>
        )}

        <div className="flex items-center justify-between gap-2 mt-5">
          <Button
            variant="ghost"
            size="md"
            border={false}
            type="button"
            onClick={() => {
              setStartDate("");
              setEndDate("");
            }}
            disabled={busy}
            className="h-[42px] px-4">
            <span className="text-sm font-[350]">Clear dates</span>
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="md"
              border={false}
              type="button"
              onClick={() => setPickerOpen(false)}
              disabled={busy}
              className="h-[42px] px-4">
              <span className="text-sm font-[350]">Cancel</span>
            </Button>
            <Button
              variant="cleano"
              size="md"
              border={false}
              type="button"
              onClick={runExport}
              disabled={busy}
              className="h-[42px] px-4 flex items-center gap-2">
              {busy ? (
                <Loader className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              <span className="text-sm font-[350]">
                Export {pendingFormat.toUpperCase()}
              </span>
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
