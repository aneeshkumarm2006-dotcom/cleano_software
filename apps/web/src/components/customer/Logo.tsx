"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";

export default function CustomerLogo({
  onDark,
  href = "/book",
}: {
  onDark?: boolean;
  href?: string;
}) {
  return (
    <Link
      href={href}
      className={`cl-logo ${onDark ? "cl-logo-on-dark" : ""}`}>
      <span className="cl-logo-mark">
        <Sparkles size={18} strokeWidth={1.8} />
      </span>
      <span>cleano</span>
    </Link>
  );
}
