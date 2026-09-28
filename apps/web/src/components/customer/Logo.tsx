"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useWorkspaceName } from "@/components/WorkspaceName";

export default function CustomerLogo({
  onDark,
  href = "/book",
}: {
  onDark?: boolean;
  href?: string;
}) {
  // This company's name, not the platform's and not another tenant's.
  const brandName = useWorkspaceName();
  return (
    <Link
      href={href}
      className={`cl-logo ${onDark ? "cl-logo-on-dark" : ""}`}>
      <span className="cl-logo-mark">
        <Sparkles size={18} strokeWidth={1.8} />
      </span>
      <span>{brandName}</span>
    </Link>
  );
}
