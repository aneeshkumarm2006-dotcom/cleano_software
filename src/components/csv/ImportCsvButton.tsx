"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  Download,
  FileSpreadsheet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Loader,
} from "lucide-react";
import Modal from "@/components/ui/Modal";
import { parseCsv, unparseCsv } from "@/lib/csv/parse";
import {
  CSV_ENTITIES,
  validateRecord,
  findUnknownColumns,
  buildTemplateCsv,
  type EntityKey,
  type ImportOptionKey,
  type ImportOptions,
} from "@/lib/csv/entities";
import { importCsv, type ImportResponse } from "@/app/admin/actions/importCsv";

interface ImportCsvButtonProps {
  entity: EntityKey;
  label?: string;
  triggerClassName?: string;
}

interface PreviewRow {
  index: number; // 1-based
  errors: string[];
  display: string; // first column's value, resolved through header aliases
}

function downloadCsv(fileName: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ImportCsvButton({ entity, label, triggerClassName }: ImportCsvButtonProps) {
  const config = CSV_ENTITIES[entity];
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [records, setRecords] = useState<Record<string, string>[]>([]);
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [unknownCols, setUnknownCols] = useState<string[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);
  // Duplicate-handling toggles declared by the entity config. All default OFF —
  // the server re-derives them as booleans and never trusts this object.
  const [options, setOptions] = useState<ImportOptions>({});

  const validCount = preview.filter((r) => r.errors.length === 0).length;
  const invalidCount = preview.length - validCount;

  function reset() {
    setFileName(null);
    setRecords([]);
    setPreview([]);
    setUnknownCols([]);
    setParseError(null);
    setResult(null);
    setOptions({});
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
    reader.onload = () => {
      try {
        const { headers, records: recs } = parseCsv(String(reader.result ?? ""));
        if (recs.length === 0) {
          setParseError("No data rows found in this file.");
          return;
        }
        setUnknownCols(findUnknownColumns(config, headers));
        setRecords(recs);
        const firstKey = config.columns[0].key;
        setPreview(
          recs.map((rec, i) => {
            const { values, errors } = validateRecord(config, rec);
            return {
              index: i + 1,
              errors,
              // Use the alias-resolved value so the column shows even when the
              // upload's header differs from our key (e.g. "Full Name" → name).
              display: values[firstKey] != null ? String(values[firstKey]) : "",
            };
          })
        );
      } catch {
        setParseError("Could not read this file. Make sure it is a valid .csv file.");
      }
    };
    reader.onerror = () => setParseError("Could not read this file.");
    reader.readAsText(file);
  }

  async function handleImport() {
    setImporting(true);
    try {
      const res = await importCsv(entity, records, options);
      setResult(res);
      if (res.ok && res.summary.created > 0) router.refresh();
    } finally {
      setImporting(false);
    }
  }

  function downloadReport() {
    if (!result) return;
    const rows: unknown[][] = [["row", "status", "name/identifier", "reason"]];
    for (const r of result.results) rows.push([r.row, r.status, r.label ?? "", r.reason ?? ""]);
    downloadCsv(`${entity}-import-report.csv`, unparseCsv(rows));
  }

  return (
    <>
      <button
        type="button"
        className={triggerClassName ?? "btn btn-secondary"}
        onClick={() => setOpen(true)}>
        <Upload size={16} /> {label ?? "Import CSV"}
      </button>

      <Modal
        isOpen={open}
        onClose={handleClose}
        title={`Import ${config.title} from CSV`}
        className="max-w-[52rem]">
        <div className="flex flex-col gap-4 text-sm text-gray-700">
          {/* Step 1 — template */}
          <div className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3">
            <div>
              <p className="font-medium text-gray-900">1. Download the template</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Columns marked <span className="font-semibold">*</span> are required. Fill it in, then upload below.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm shrink-0"
              onClick={() => downloadCsv(config.fileName, buildTemplateCsv(config))}>
              <Download size={14} /> Template
            </button>
          </div>

          {config.guidance.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-gray-500 space-y-1">
              {config.guidance.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          )}

          {/* Step 2 — upload */}
          <div>
            <p className="font-medium text-gray-900 mb-2">2. Upload your CSV</p>
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
              onClick={() => fileInputRef.current?.click()}>
              <FileSpreadsheet size={16} /> {fileName ? "Choose a different file" : "Choose CSV file"}
            </button>
            {fileName && <span className="ml-2 text-xs text-gray-500">{fileName}</span>}
          </div>

          {parseError && (
            <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangle size={14} /> {parseError}
            </div>
          )}

          {/* Unknown columns banner */}
          {unknownCols.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle size={14} /> Some columns aren&apos;t supported yet
              </div>
              <p className="mt-1">
                These columns were not recognized and will be ignored:{" "}
                <span className="font-mono">{unknownCols.join(", ")}</span>. To have them imported, please
                reach out to your developer to add these columns in the backend.
              </p>
            </div>
          )}

          {/* Duplicate-handling options (entity-declared, all default OFF) */}
          {!result && preview.length > 0 && (config.importOptions?.length ?? 0) > 0 && (
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <div className="text-xs font-[450] text-gray-600 mb-2 uppercase tracking-wider">
                Duplicate handling
              </div>
              {config.importOptions!.map((opt) => {
                const checked = options[opt.key] === true;
                return (
                  <div key={opt.key}>
                    <label className="flex items-start gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={checked}
                        onChange={(e) =>
                          setOptions((o) => ({
                            ...o,
                            [opt.key as ImportOptionKey]: e.target.checked,
                          }))
                        }
                      />
                      <span>{opt.label}</span>
                    </label>
                    {opt.help && (
                      <p className="ml-6 text-xs text-gray-500 mt-0.5">{opt.help}</p>
                    )}
                    {checked && opt.warning && (
                      <p className="ml-6 text-xs text-amber-600 mt-1">{opt.warning}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Preview */}
          {!result && preview.length > 0 && (
            <div>
              <div className="flex items-center gap-3 text-xs mb-2">
                <span className="text-gray-600">{preview.length} rows</span>
                <span className="text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 size={13} /> {validCount} ready
                </span>
                {invalidCount > 0 && (
                  <span className="text-red-700 flex items-center gap-1">
                    <XCircle size={13} /> {invalidCount} will be skipped
                  </span>
                )}
              </div>
              <div className="max-h-64 overflow-auto rounded-xl border border-gray-100">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr className="text-left text-gray-500">
                      <th className="px-2 py-1.5 w-10">#</th>
                      <th className="px-2 py-1.5">{config.columns[0].key}</th>
                      <th className="px-2 py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 100).map((r) => {
                      const ok = r.errors.length === 0;
                      return (
                        <tr key={r.index} className="border-t border-gray-50">
                          <td className="px-2 py-1.5 text-gray-400">{r.index}</td>
                          <td className="px-2 py-1.5 text-gray-800">
                            {r.display || "—"}
                          </td>
                          <td className="px-2 py-1.5">
                            {ok ? (
                              <span className="text-emerald-700">Ready</span>
                            ) : (
                              <span className="text-red-600">{r.errors.join("; ")}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {preview.length > 100 && (
                  <div className="px-2 py-1.5 text-[11px] text-gray-400 border-t border-gray-50">
                    …and {preview.length - 100} more rows
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="rounded-xl border border-gray-100 p-3">
              {!result.ok ? (
                <div className="flex items-center gap-2 text-red-700">
                  <XCircle size={15} /> {result.error}
                </div>
              ) : (
                <>
                  <p className="font-medium text-gray-900 mb-2">Import complete</p>
                  <div className="flex flex-wrap gap-4 text-xs">
                    <span className="flex items-center gap-1 text-emerald-700">
                      <CheckCircle2 size={14} /> {result.summary.created} created
                    </span>
                    <span className="flex items-center gap-1 text-gray-500">
                      <MinusCircle size={14} /> {result.summary.skipped} skipped
                      {result.summary.skipped > 0 &&
                        ` (${result.summary.duplicates} duplicate${
                          result.summary.skipped > result.summary.duplicates
                            ? `, ${result.summary.skipped - result.summary.duplicates} other`
                            : ""
                        })`}
                    </span>
                    <span className="flex items-center gap-1 text-red-600">
                      <XCircle size={14} /> {result.summary.failed} failed
                    </span>
                  </div>
                  {(result.summary.failed > 0 || result.summary.skipped > 0) && (
                    <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={downloadReport}>
                      <Download size={14} /> Download full report
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" className="btn btn-ghost" onClick={handleClose}>
              {result?.ok ? "Done" : "Cancel"}
            </button>
            {!result && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={importing || validCount === 0}
                onClick={handleImport}>
                {importing ? (
                  <>
                    <Loader size={15} className="animate-spin" /> Importing…
                  </>
                ) : (
                  <>Import {validCount > 0 ? validCount : ""} rows</>
                )}
              </button>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
