"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle, MessagesSquare } from "lucide-react";

// Spec item 24: Direct Messages and Group Chat live under ONE communication
// tab, with sub-tabs — same structure on the admin and cleaner sides.
export default function ChatTabs({ variant }: { variant: "admin" | "cleaner" }) {
  const pathname = usePathname();
  const base = variant === "admin" ? "/admin" : "/cleaners";
  const tabs = [
    { href: `${base}/chat`, label: "Direct messages", Icon: MessageCircle },
    { href: `${base}/group-chat`, label: "Group chat", Icon: MessagesSquare },
  ];

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        padding: "10px 16px 0",
        flex: "0 0 auto",
      }}>
      {tabs.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "7px 14px",
              borderRadius: 999,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              background: active ? "var(--primary)" : "transparent",
              color: active ? "#fff" : "var(--primary-60)",
              border: active
                ? "1px solid var(--primary)"
                : "1px solid var(--primary-20)",
            }}>
            <Icon size={15} />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
