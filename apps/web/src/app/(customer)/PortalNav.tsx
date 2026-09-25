"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/bookings", label: "Bookings" },
  { href: "/account", label: "Account" },
];

export default function PortalNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {LINKS.map((l) => {
        const active =
          l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`px-3 py-1.5 rounded-full text-xs transition-colors ${
              active
                ? "bg-[var(--primary)] text-white"
                : "text-[var(--primary)]/70 hover:bg-[var(--primary)]/5"
            }`}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
