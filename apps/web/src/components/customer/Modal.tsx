"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  width?: number;
}

export default function CustomerModal({
  open,
  onClose,
  title,
  description,
  children,
  width = 460,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const prevBg = useRef("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    prevBg.current = document.documentElement.style.background;
    document.documentElement.style.background = "var(--ink)";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.documentElement.style.background = prevBg.current;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="cl-customer cl-modal-backdrop" onClick={onClose}>
      <div
        className="cl-modal"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}>
        <header className="cl-modal-head">
          <div>
            <h2 className="cl-modal-title">{title}</h2>
            {description ? (
              <p className="cl-modal-desc">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="cl-icon-btn"
            aria-label="Close"
            onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="cl-modal-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
