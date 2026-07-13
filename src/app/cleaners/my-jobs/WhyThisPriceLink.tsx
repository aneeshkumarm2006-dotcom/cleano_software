"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import PayBreakdownModal from "./PayBreakdownModal";

interface WhyThisPriceLinkProps {
  jobId: string;
  className?: string;
}

/**
 * Opens the cleaner-safe pay view. The old "Why this price?" wording promised
 * the client-pricing story; cleaners never see client pricing (item 1), so the
 * link now offers their pay details only.
 */
export default function WhyThisPriceLink({
  jobId,
  className = "",
}: WhyThisPriceLinkProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 text-xs text-[#008C9C] hover:text-[#008C9C]/80 underline decoration-dotted underline-offset-2 transition-colors ${className}`}>
        <Info className="w-3 h-3" />
        Pay details
      </button>
      <PayBreakdownModal
        jobId={jobId}
        isOpen={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
