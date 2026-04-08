"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  LayoutDashboard,
  BarChart3,
  Users,
  Package,
  Briefcase,
  ClipboardList,
  CalendarDays,
  LucideIcon,
} from "lucide-react";

const iconMap: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  analytics: BarChart3,
  employees: Users,
  inventory: Package,
  jobs: Briefcase,
  "my-jobs": ClipboardList,
  calendar: CalendarDays,
};

export default function NavLink({
  href,
  children,
  icon,
  iconOnly = false,
}: {
  href: string;
  children: React.ReactNode;
  icon: string;
  iconOnly?: boolean;
}) {
  const pathname = usePathname();
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const linkRef = useRef<HTMLAnchorElement>(null);
  const isActive =
    pathname === href || (href !== "/dashboard" && pathname?.startsWith(href));

  const Icon = iconMap[icon];

  const updateTooltipPosition = () => {
    if (linkRef.current) {
      const rect = linkRef.current.getBoundingClientRect();
      setTooltipPosition({
        top: rect.top + rect.height / 2,
        left: rect.right + 16,
      });
    }
  };

  useEffect(() => {
    if (showTooltip) {
      updateTooltipPosition();
      window.addEventListener("scroll", updateTooltipPosition, true);
      window.addEventListener("resize", updateTooltipPosition);
      return () => {
        window.removeEventListener("scroll", updateTooltipPosition, true);
        window.removeEventListener("resize", updateTooltipPosition);
      };
    }
  }, [showTooltip]);

  if (iconOnly) {
    return (
      <>
        <Link
          ref={linkRef}
          href={href}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          className={`flex items-center justify-center w-12 h-12 rounded-xl transition-all duration-150 ${
            isActive
              ? "bg-[#005F6A] text-white shadow-sm"
              : "text-[#005F6A] hover:bg-[#005F6A]/10 hover:text-[#005F6A]"
          }`}>
          {Icon && (
            <Icon
              strokeWidth={1.6}
              className={`w-5 h-5 ${
                isActive ? "text-white" : "text-[#005F6A]"
              }`}
            />
          )}
        </Link>
        {showTooltip &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className="fixed z-[9999] pointer-events-none"
              style={{
                top: `${tooltipPosition.top}px`,
                left: `${tooltipPosition.left}px`,
                transform: "translateY(-50%)",
              }}>
              <div className="bg-[#005F6A] text-white text-sm font-[350] px-3 py-2 rounded-lg whitespace-nowrap shadow-lg">
                {children}
                <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[#005F6A]" />
              </div>
            </div>,
            document.body
          )}
      </>
    );
  }

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-[350] transition-all duration-150 ${
        isActive
          ? "bg-[#005F6A] text-white shadow-sm"
          : "text-[#005F6A] hover:bg-[#005F6A]/10 hover:text-[#005F6A]"
      }`}>
      {Icon && (
        <Icon
          strokeWidth={1.6}
          className={`w-5 h-5 ${isActive ? "text-white" : "text-[#005F6A]"}`}
        />
      )}
      {children}
    </Link>
  );
}
