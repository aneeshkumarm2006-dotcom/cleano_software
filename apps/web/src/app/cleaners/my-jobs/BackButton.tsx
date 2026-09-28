"use client";

import { useRouter } from "next/navigation";

export default function BackButton({ label = "Back to my jobs" }: { label?: string }) {
  const router = useRouter();
  return (
    <button className="cl-jd-back" onClick={() => router.back()}>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
      </svg>
      {label}
    </button>
  );
}
