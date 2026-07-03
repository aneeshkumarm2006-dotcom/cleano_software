"use client";

import { useRef, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader,
  Table2,
} from "lucide-react";
import Modal from "@/components/ui/Modal";
import { runBookingKoalaImport } from "@/app/admin/actions/runBookingKoalaImport";
import type { ImportReport } from "@/lib/bookingkoala/core";
import { parseCsv } from "@/lib/csv/parse";

const STATUS_COLOR: Record<string, string> = {
  PAID: "text-emerald-700",
  SCHEDULED: "text-blue-700",
  CREATED: "text-gray-500",
};

// Commit the import in slices so each server request finishes well under the
// serverless timeout (the whole-file commit 504s). 50 rows ≈ a few seconds of
// DB writes — safely inside the page's 60s maxDuration.
const BATCH_SIZE = 50;

export default function BookingKoalaImportButton({
  triggerClassName,
}: {
  triggerClassName?: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "dry" | "commit">(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [committed, setCommitted] = useState(false);
  // Live batch progress during a chunked commit.
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    batch: number;
    batches: number;
  } | null>(null);
  // Email toggles — cleaners on by default; customers can be turned off so the
  // client doesn't notify customers at import time.
  const [emailCleaners, setEmailCleaners] = useState(true);
  const [emailCustomers, setEmailCustomers] = useState(true);
  const [showFullData, setShowFullData] = useState(false);

  // Full CSV grid for the reference preview (parsed client-side from the file).
  const fullData = useMemo(() => {
    if (!csvText) return null;
    try {
      return parseCsv(csvText);
    } catch {
      return null;
    }
  }, [csvText]);

  function reset() {
    setFileName(null);
    setCsvText("");
    setParseError(null);
    setReport(null);
    setCommitted(false);
    setProgress(null);
    setBusy(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  function handleClose() {
    setOpen(false);
    reset();
  }

  function handleFile(file: File) {
    reset();
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = async () => {
      const text = String(reader.result ?? "");
      setCsvText(text);
      setBusy("dry");
      try {
        const res = await runBookingKoalaImport(text, { commit: false });
        setReport(res);
        if (!res.ok) setParseError(res.error ?? "Could not read this file.");
      } finally {
        setBusy(null);
      }
    };
    reader.onerror = () => setParseError("Could not read this file.");
    reader.readAsText(file);
  }

  async function handleCommit() {
    if (!csvText || !report) return;
    const total = report.totalRows ?? 0;
    if (total === 0) {
      setParseError("Nothing to import.");
      return;
    }
    const batches = Math.ceil(total / BATCH_SIZE);

    // Final summary is assembled from the batches. Cleaner/customer/address
    // breakdown is taken from the dry-run (accurate, and avoids double-counting
    // a "now-existing" account across later slices); jobs/emails/statuses are
    // accumulated from the real writes.
    const acc: ImportReport = {
      ok: true,
      dryRun: false,
      parsedCount: report.parsedCount,
      droppedCount: report.droppedCount,
      problemRows: report.problemRows,
      mojibakeCount: report.mojibakeCount,
      totalRows: total,
      cleaners: { ...report.cleaners },
      customers: { ...report.customers },
      addresses: report.addresses,
      jobs: { created: 0, skipped: 0, failed: 0 },
      statusCounts: {},
      emails: { sent: 0, failed: 0 },
      sample: report.sample,
      failures: [],
    };

    setBusy("commit");
    setProgress({ done: 0, total, batch: 0, batches });
    try {
      for (let i = 0; i < batches; i++) {
        const start = i * BATCH_SIZE;
        // Run one batch, retrying once on a thrown error (serverless 504 /
        // network drop). Without this, a timed-out batch used to throw out of
        // the loop with NO error shown, silently dropping every later batch.
        let res: Awaited<ReturnType<typeof runBookingKoalaImport>> | null = null;
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 2 && !res; attempt++) {
          try {
            res = await runBookingKoalaImport(csvText, {
              commit: true,
              sendCleanerEmails: emailCleaners,
              sendCustomerEmails: emailCustomers,
              batch: { start, size: BATCH_SIZE },
            });
          } catch (e) {
            lastErr = e;
          }
        }
        if (!res) {
          // Both attempts threw (timeout/network). Surface a clear message with
          // how far we got — already-imported rows are idempotent, so re-running
          // resumes safely.
          setReport({ ...acc, ok: false, error: "Batch timed out." });
          setParseError(
            `Import stopped at batch ${i + 1} of ${batches} (server timed out${
              lastErr instanceof Error ? `: ${lastErr.message}` : ""
            }). ${acc.jobs.created} bookings saved so far — click Import again to finish the rest (already-imported rows are skipped).`
          );
          return;
        }
        if (!res.ok) {
          // Stop on a hard failure — already-imported rows stay (idempotent), so
          // the user can simply re-run to finish the rest.
          setReport({ ...acc, ok: false, error: res.error ?? "Batch failed." });
          setParseError(
            `Batch ${i + 1} of ${batches} failed${res.error ? `: ${res.error}` : ""}. Already-imported rows are saved — click Import again to finish the rest.`
          );
          return;
        }
        acc.jobs.created += res.jobs.created;
        acc.jobs.skipped += res.jobs.skipped;
        acc.jobs.failed += res.jobs.failed;
        acc.emails.sent += res.emails.sent;
        acc.emails.failed += res.emails.failed;
        for (const [k, v] of Object.entries(res.statusCounts)) {
          acc.statusCounts[k] = (acc.statusCounts[k] ?? 0) + v;
        }
        acc.failures.push(...res.failures);
        setProgress({
          done: Math.min(start + BATCH_SIZE, total),
          total,
          batch: i + 1,
          batches,
        });
        setReport({ ...acc });
      }
      acc.failures = acc.failures.slice(0, 50);
      setReport({ ...acc });
      setCommitted(true);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const counts = report;

  return (
    <>
      <button
        type="button"
        className={triggerClassName ?? "btn btn-secondary"}
        onClick={() => setOpen(true)}>
        <Upload size={16} /> BookingKoala Import
      </button>

      <Modal
        isOpen={open}
        onClose={handleClose}
        title="Import from BookingKoala"
        className="max-w-[52rem]">
        <div className="flex flex-col gap-4 text-sm text-gray-700">
          <p className="text-xs text-gray-500">
            Upload a BookingKoala bookings export. We preview a full dry-run first
            (nothing is written) — review the numbers, then commit. Customers &amp;
            cleaners get login accounts; whether they&rsquo;re emailed their login is
            controlled by the toggles below. Booking-confirmation emails are never
            sent and Stripe is never touched.
          </p>

          {/* Upload */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy !== null}
              onClick={() => fileInputRef.current?.click()}>
              <FileSpreadsheet size={16} />{" "}
              {fileName ? "Choose a different file" : "Choose CSV file"}
            </button>
            {fileName && <span className="ml-2 text-xs text-gray-500">{fileName}</span>}
          </div>

          {busy === "dry" && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Loader size={14} className="animate-spin" /> Running dry-run…
            </div>
          )}

          {parseError && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={14} /> {parseError}
            </div>
          )}

          {/* Report */}
          {counts && counts.ok && (
            <div className="rounded-xl border border-gray-100 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-gray-900">
                  {committed ? "Import complete" : "Dry-run preview"}
                </p>
                <span className="text-[11px] text-gray-400">
                  {counts.parsedCount} rows parsed · {counts.droppedCount} skipped (unreadable/blank date)
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                <Row label="Cleaners" v={`${counts.cleaners.created} new, ${counts.cleaners.existing} existing${counts.cleaners.failed ? `, ${counts.cleaners.failed} failed` : ""}`} />
                <Row label="Customers" v={`${counts.customers.created} new, ${counts.customers.existing} existing${counts.customers.failed ? `, ${counts.customers.failed} failed` : ""}`} />
                <Row label="Addresses" v={`${counts.addresses}`} />
                <Row label="Jobs" v={`${counts.jobs.created} created, ${counts.jobs.skipped} skipped${counts.jobs.failed ? `, ${counts.jobs.failed} failed` : ""}`} />
              </div>

              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {Object.entries(counts.statusCounts).map(([k, n]) => (
                  <span key={k} className={STATUS_COLOR[k] ?? "text-gray-600"}>
                    ● {k}: {n}
                  </span>
                ))}
              </div>

              {committed && (
                <p className="mt-2 text-xs text-gray-600">
                  Emails: {counts.emails.sent} sent
                  {counts.emails.failed ? `, ${counts.emails.failed} failed` : ""} (cleaner +
                  customer welcome). Booking confirmations never sent · Stripe never touched.
                </p>
              )}

              {counts.failures.length > 0 && (
                <div className="mt-2 rounded-lg border border-red-100 bg-red-50 p-2 text-[11px] text-red-700 max-h-28 overflow-auto">
                  {counts.failures.map((f, i) => (
                    <div key={i}>{f}</div>
                  ))}
                </div>
              )}

              {/* Sample */}
              {counts.sample.length > 0 && !committed && (
                <div className="mt-3 max-h-52 overflow-auto rounded-lg border border-gray-100">
                  <table className="w-full text-[11px]">
                    <thead className="bg-gray-50 sticky top-0 text-left text-gray-500">
                      <tr>
                        <th className="px-2 py-1">Customer</th>
                        <th className="px-2 py-1">Service</th>
                        <th className="px-2 py-1">Start</th>
                        <th className="px-2 py-1">Price</th>
                        <th className="px-2 py-1">Status</th>
                        <th className="px-2 py-1">Cl.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {counts.sample.map((s) => (
                        <tr key={s.row} className="border-t border-gray-50">
                          <td className="px-2 py-1 text-gray-800">{s.client}</td>
                          <td className="px-2 py-1">{s.jobType}</td>
                          <td className="px-2 py-1 text-gray-500">{s.start.replace("T", " ")}</td>
                          <td className="px-2 py-1">${s.price}</td>
                          <td className={`px-2 py-1 ${STATUS_COLOR[s.status] ?? ""}`}>{s.status}</td>
                          <td className="px-2 py-1 text-gray-500">{s.cleaners}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Will-not-import problem rows (#3) */}
              {counts.problemRows.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                  <div className="flex items-center gap-1.5 text-[12px] font-medium text-amber-800 mb-1.5">
                    <AlertTriangle size={13} />
                    {counts.problemRows.length} row
                    {counts.problemRows.length === 1 ? "" : "s"} will NOT be imported
                  </div>
                  <p className="text-[11px] text-amber-700 mb-2">
                    These rows are missing a readable booking date, so a job can&apos;t be
                    created. Fix them in your CSV and re-import — everything else imports fine.
                  </p>
                  <div className="max-h-40 overflow-auto rounded border border-amber-100 bg-white">
                    <table className="w-full text-[11px]">
                      <thead className="bg-amber-50/60 sticky top-0 text-left text-amber-700">
                        <tr>
                          <th className="px-2 py-1">Row</th>
                          <th className="px-2 py-1">Customer</th>
                          <th className="px-2 py-1">Booking ID</th>
                          <th className="px-2 py-1">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {counts.problemRows.map((pr) => (
                          <tr key={pr.rowNum} className="border-t border-amber-50">
                            <td className="px-2 py-1 text-gray-500">{pr.rowNum}</td>
                            <td className="px-2 py-1 text-gray-800">{pr.customer}</td>
                            <td className="px-2 py-1 text-gray-500">{pr.bookingId ?? "—"}</td>
                            <td className="px-2 py-1 text-amber-700">{pr.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Full CSV data preview (#2) — every column and row, for reference */}
          {fullData && fullData.records.length > 0 && !committed && (
            <div className="rounded-xl border border-gray-100 p-3">
              <button
                type="button"
                onClick={() => setShowFullData((s) => !s)}
                className="flex w-full items-center justify-between text-sm font-medium text-gray-800">
                <span className="flex items-center gap-1.5">
                  <Table2 size={14} />
                  Preview all data ({fullData.records.length} rows · {fullData.headers.length} columns)
                </span>
                <span className="text-xs text-[#008C9C]">{showFullData ? "Hide" : "Show"}</span>
              </button>
              {showFullData && (
                <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-gray-100">
                  <table className="text-[11px] whitespace-nowrap">
                    <thead className="bg-gray-50 sticky top-0 text-left text-gray-500">
                      <tr>
                        <th className="px-2 py-1 sticky left-0 bg-gray-50">#</th>
                        {fullData.headers.map((h) => (
                          <th key={h} className="px-2 py-1">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {fullData.records.map((rec, i) => (
                        <tr key={i} className="border-t border-gray-50">
                          <td className="px-2 py-1 text-gray-400 sticky left-0 bg-white">{i + 2}</td>
                          {fullData.headers.map((h) => (
                            <td key={h} className="px-2 py-1 text-gray-700">{rec[h]}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Email options (before commit) */}
          {report?.ok && !committed && (
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
              <div className="text-xs font-[450] text-gray-600 mb-2 uppercase tracking-wider">
                Welcome / login emails on import
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={emailCleaners}
                  onChange={(e) => setEmailCleaners(e.target.checked)}
                />
                Email cleaners their login + temporary password
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 mt-1.5">
                <input
                  type="checkbox"
                  checked={emailCustomers}
                  onChange={(e) => setEmailCustomers(e.target.checked)}
                />
                Email customers their login + temporary password
              </label>
              {!emailCustomers && (
                <p className="text-xs text-amber-600 mt-2">
                  Customers will be imported but <strong>not</strong> emailed now — they
                  won&rsquo;t be able to log in until you send their credentials later.
                </p>
              )}
            </div>
          )}

          {/* Batch progress (during commit) */}
          {busy === "commit" && progress && (
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="flex items-center justify-between text-xs text-gray-600 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Loader size={13} className="animate-spin" />
                  Importing — batch {progress.batch} of {progress.batches}
                </span>
                <span className="font-medium text-gray-900">
                  {progress.done} / {progress.total} rows
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                  style={{
                    width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                  }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400">
                Please keep this window open — it sends rows in small batches so the
                server never times out.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" className="btn btn-ghost" onClick={handleClose}>
              {committed ? "Done" : "Cancel"}
            </button>
            {report?.ok && !committed && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null}
                onClick={handleCommit}>
                {busy === "commit" ? (
                  <>
                    <Loader size={15} className="animate-spin" />{" "}
                    {progress
                      ? `Importing ${progress.done}/${progress.total}…`
                      : "Importing…"}
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={15} /> Import for real ({report.jobs.created} jobs)
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

function Row({ label, v }: { label: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-gray-50 py-0.5">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium">{v}</span>
    </div>
  );
}
