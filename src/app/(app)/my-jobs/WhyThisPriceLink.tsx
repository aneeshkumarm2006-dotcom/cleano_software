"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import PayBreakdownModal from "./PayBreakdownModal";

interface WhyThisPriceLinkProps {
  jobId: string;
  className?: string;
}

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
        Why this price?
      </button>
      <PayBreakdownModal
        jobId={jobId}
        isOpen={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
