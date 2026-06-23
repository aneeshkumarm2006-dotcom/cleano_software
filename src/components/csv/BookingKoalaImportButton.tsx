"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader,
} from "lucide-react";
import Modal from "@/components/ui/Modal";
import { runBookingKoalaImport } from "@/app/(app)/actions/runBookingKoalaImport";
import type { ImportReport } from "@/lib/bookingkoala/core";

const STATUS_COLOR: Record<string, string> = {
  PAID: "text-emerald-700",
  SCHEDULED: "text-blue-700",
  CREATED: "text-gray-500",
};

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

  function reset() {
    setFileName(null);
    setCsvText("");
    setParseError(null);
    setReport(null);
    setCommitted(false);
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
    if (!csvText) return;
    setBusy("commit");
    try {
      const res = await runBookingKoalaImport(csvText, { commit: true });
      setReport(res);
      setCommitted(res.ok);
      if (res.ok) router.refresh();
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
            cleaners get login accounts + welcome emails; booking-confirmation
            emails are never sent and Stripe is never touched.
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
                  {counts.parsedCount} rows parsed · {counts.droppedCount} out of range
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
                    <Loader size={15} className="animate-spin" /> Importing…
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
