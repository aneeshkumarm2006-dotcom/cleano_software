"use client";

import { useEffect, useState } from "react";
import { Check, ClipboardCopy, Loader } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { fmtDate, fmtTime } from "@/lib/time";
import { getAvailableJobPreview } from "./getAvailableJobPreview";
import type { AvailableJobPreview } from "./getAvailableJobPreview.types";
import { propertyTypeLabel } from "@/lib/property-type";

interface JobPreviewModalProps {
  jobId: string | null;
  onClose: () => void;
  /** Claim straight from the preview, so a decision needs one tap, not two. */
  onClaim: (jobId: string) => void;
  claiming: boolean;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-neutral-100 last:border-b-0">
      <span className="text-sm text-neutral-500 flex-shrink-0">{label}</span>
      <span className="text-sm text-neutral-900 text-right">{value}</span>
    </div>
  );
}

export default function JobPreviewModal({
  jobId,
  onClose,
  onClaim,
  claiming,
}: JobPreviewModalProps) {
  const [data, setData] = useState<AvailableJobPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setCopied(false);
    getAvailableJobPreview(jobId).then((res) => {
      if (cancelled) return;
      if (res.success) setData(res.preview);
      else setError(res.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  async function copyAddress() {
    if (!data?.address) return;
    try {
      // Absent on insecure origins and older in-app browsers — a phone is the
      // likeliest device here, so failing loudly beats a dead button.
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(data.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy — select the address and copy it manually.");
    }
  }

  const size = data
    ? [
        // Stage 9 — leads the line: "House" tells a cleaner more about what
        // they're claiming than any room count does, and it drops out silently
        // on the many jobs where it was never recorded.
        propertyTypeLabel(data.propertyType),
        data.bedCount != null ? `${data.bedCount}bd` : null,
        data.bathCount != null ? `${data.bathCount}ba` : null,
        data.halfBathCount ? `${data.halfBathCount} half` : null,
        data.squareFootage ? `${data.squareFootage} sq ft` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <Modal
      isOpen={jobId !== null}
      onClose={onClose}
      title={data ? `Job #${data.jobNumber}` : "Job preview"}
      subheader={data ? data.clientName : undefined}>
      {loading && (
        <div className="flex items-center justify-center py-10 text-neutral-500">
          <Loader className="w-5 h-5 animate-spin mr-2" />
          Loading job details…
        </div>
      )}

      {error && !loading && (
        <div className="p-3 rounded-xl text-sm bg-red-50 border border-red-200 text-red-700">
          {error}
        </div>
      )}

      {data && !loading && (
        <div className="space-y-5">
          <div>
            <Row
              label="When"
              value={`${fmtDate(data.startTime, {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}, ${fmtTime(data.startTime)}${data.isFlexible ? " (flexible)" : ""}`}
            />
            <Row
              label="Est. duration"
              value={
                data.durationMinutes != null
                  ? `${(data.durationMinutes / 60).toFixed(1)}h`
                  : // No per-jobType default exists in this codebase, so there
                    // is nothing honest to fall back to.
                    "Set by dispatch"
              }
            />
            <Row label="Service" value={data.serviceType ?? "Not specified"} />
            {size && <Row label="Property" value={size} />}
            <Row
              label="Your est. pay"
              value={
                data.estHourly != null
                  ? `$${data.estHourly.toFixed(2)}/hr`
                  : data.estPay != null
                    ? `$${data.estPay.toFixed(2)}`
                    : "Set on assignment"
              }
            />
            <Row
              label="Spots left"
              value={`${Math.max(0, data.requiredCleaners - data.claimedCount)} of ${data.requiredCleaners}`}
            />
          </div>

          {data.address && (
            <div>
              <div className="text-[11px] uppercase tracking-wider font-bold text-neutral-500 mb-1.5">
                Address
              </div>
              <div className="flex items-start gap-2">
                <p className="text-sm text-neutral-900 flex-1">{data.address}</p>
                <button
                  type="button"
                  onClick={copyAddress}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-200 text-xs text-neutral-700 hover:bg-neutral-50">
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5" /> Copied
                    </>
                  ) : (
                    <>
                      <ClipboardCopy className="w-3.5 h-3.5" /> Copy
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-neutral-500 mt-1.5">
                Door and access codes are shown once the job is yours.
              </p>
            </div>
          )}

          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-neutral-500 mb-1.5">
              Add-ons{data.addOns.length > 0 ? ` (${data.addOns.length})` : ""}
            </div>
            {data.addOns.length === 0 ? (
              <p className="text-sm text-neutral-500">No add-ons for this job.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.addOns.map((a) => (
                  <span
                    key={a.name}
                    className="px-2.5 py-1.5 rounded-lg bg-neutral-50 border border-neutral-200 text-sm text-neutral-900">
                    {a.name}
                    {a.quantity > 1 ? ` ×${a.quantity}` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-neutral-500 mb-1.5">
              Checklist
            </div>
            {data.checklistTemplates.length === 0 ? (
              <p className="text-sm text-neutral-500">
                No checklist configured for this job type.
              </p>
            ) : (
              <ul className="space-y-1">
                {data.checklistTemplates.map((t) => (
                  <li key={t.name} className="text-sm text-neutral-900">
                    {t.name}{" "}
                    <span className="text-neutral-500">
                      — {t.itemCount} item{t.itemCount === 1 ? "" : "s"}
                      {t.requiredCount > 0 ? `, ${t.requiredCount} required` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-neutral-500 mb-1.5">
              Special instructions
            </div>
            <p className="text-sm text-neutral-700 whitespace-pre-line">
              {data.notes || "None from the client."}
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-neutral-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm text-neutral-700 hover:bg-neutral-100">
              Close
            </button>
            <button
              type="button"
              onClick={() => onClaim(data.id)}
              disabled={claiming}
              className="px-4 py-2 rounded-xl text-sm text-white bg-[#008C9C] hover:bg-[#008C9C]/90 disabled:opacity-50">
              {claiming ? "Claiming…" : "Claim this job"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
