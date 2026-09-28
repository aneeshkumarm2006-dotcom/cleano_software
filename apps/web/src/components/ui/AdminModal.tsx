"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface AdminModalProps {
  open: boolean;
  title?: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  variant?: "center" | "drawer";
  width?: number;
}

/**
 * Reusable admin modal — centered dialog or right drawer.
 * Ported from the Cleano design handoff (`window.AModal`).
 */
export default function AdminModal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  variant = "center",
  width = 480,
}: AdminModalProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;
  const drawer = variant === "drawer";

  return createPortal(
    <div
      className={`amodal-overlay ${drawer ? "drawer" : ""}`}
      onClick={onClose}>
      <div
        className={`amodal ${drawer ? "amodal-drawer" : ""} admin-font`}
        style={drawer ? { width } : { maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true">
        <div className="amodal-head">
          <div>
            {title ? <h3 className="amodal-title">{title}</h3> : null}
            {subtitle ? <p className="amodal-sub">{subtitle}</p> : null}
          </div>
          <button
            className="icon-btn"
            style={{ width: 32, height: 32, flex: "0 0 auto" }}
            onClick={onClose}
            aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="amodal-body">{children}</div>
        {footer ? <div className="amodal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}
