import React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import IconButton from "./IconButton";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subheader?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export default function Modal({
  isOpen,
  onClose,
  title,
  subheader,
  children,
  className = "",
}: ModalProps) {
  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{
          backdropFilter: "blur(2px)",
          backgroundColor: "rgba(175, 175, 175, 0.1)",
        }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={`relative z-[10000] bg-white rounded-2xl shadow-sm max-h-[90vh] max-w-[45rem] w-full mx-4 flex flex-col ${className}`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 pb-0 flex-shrink-0">
          <div>
            <h2 className="text-lg font-[400] text-gray-900">{title}</h2>
            {subheader && (
              <div className="px-0 pb-0 flex-shrink-0">
                {typeof subheader === "string" ? (
                  <div className="text-sm text-gray-600">{subheader}</div>
                ) : (
                  subheader
                )}
              </div>
            )}
          </div>
          <IconButton
            icon={X}
            onClick={onClose}
            size="sm"
            variant="ghost"
            className="text-gray-400 hover:text-neutral-950"
          />
        </div>

        {/* Content */}
        <div className="p-4 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
