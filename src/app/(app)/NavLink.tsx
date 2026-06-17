"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BarChart3,
  Users,
  Package,
  Briefcase,
  ClipboardList,
  CalendarDays,
  Contact,
  Wallet,
  Receipt,
  FileText,
  MapPin,
  Banknote,
  Droplets,
  GraduationCap,
  FileSignature,
  MessageCircle,
  Flame,
  Clock,
  Inbox,
  Globe,
  ScrollText,
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
  clients: Contact,
  payouts: Wallet,
  finances: Receipt,
  invoices: FileText,
  sales: MapPin,
  "my-pay": Banknote,
  "my-inventory": Package,
  "rag-wash": Droplets,
  training: GraduationCap,
  documents: FileSignature,
  chat: MessageCircle,
  leads: Flame,
  waitlist: Clock,
  requests: Inbox,
  "web-bookings": Globe,
  logs: ScrollText,
};

export default function NavLink({
  href,
  children,
  icon,
  expanded = false,
  exclude = [],
  badge = 0,
}: {
  href: string;
  children: React.ReactNode;
  icon: string;
  expanded?: boolean;
  exclude?: string[];
  badge?: number;
}) {
  const pathname = usePathname();
  const matchesExclude = exclude.some(
    (p) => pathname === p || pathname?.startsWith(p + "/"),
  );
  const isActive =
    !matchesExclude &&
    (pathname === href ||
      (href !== "/dashboard" && pathname?.startsWith(href + "/")));

  const Icon = iconMap[icon];

  const badgeEl = badge > 0 ? (
    <span className="min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-[600] rounded-full flex items-center justify-center px-1 leading-none flex-shrink-0">
      {badge > 99 ? "99+" : badge}
    </span>
  ) : null;

  if (expanded) {
    return (
      <Link
        href={href}
        className={`flex items-center gap-3 h-12 px-3 rounded-xl text-sm font-[350] transition-colors duration-150 ${
          isActive
            ? "bg-[#008C9C] text-white shadow-sm"
            : "text-[#008C9C] hover:bg-[#008C9C]/10 hover:text-[#008C9C]"
        }`}>
        {Icon && (
          <Icon
            strokeWidth={1.6}
            className={`w-5 h-5 shrink-0 ${
              isActive ? "text-white" : "text-[#008C9C]"
            }`}
          />
        )}
        <span className="truncate flex-1">{children}</span>
        {badgeEl}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className={`relative flex items-center justify-center w-12 h-12 rounded-xl transition-colors duration-150 ${
        isActive
          ? "bg-[#008C9C] text-white shadow-sm"
          : "text-[#008C9C] hover:bg-[#008C9C]/10 hover:text-[#008C9C]"
      }`}>
      {Icon && (
        <Icon
          strokeWidth={1.6}
          className={`w-5 h-5 ${
            isActive ? "text-white" : "text-[#008C9C]"
          }`}
        />
      )}
      {badge > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-[700] rounded-full flex items-center justify-center px-1 leading-none">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}
