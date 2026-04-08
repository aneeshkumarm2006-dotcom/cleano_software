"use client";

import React from "react";
import { X, CheckCircle, XCircle, Loader } from "lucide-react";
import Button from "./Button";
import Modal from "./Modal";
import { useTranslations } from "next-intl";

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: "success" | "error" | "loading";
  title: string;
  message: string;
}

export default function NotificationModal({
  isOpen,
  onClose,
  type,
  title,
  message,
}: NotificationModalProps) {
  const t = useTranslations("reporting.notification");

  const getIconAndColors = () => {
    switch (type) {
      case "success":
        return {
          Icon: CheckCircle,
          iconColor: "text-green-500",
          bgColor: "bg-green-50",
        };
      case "error":
        return {
          Icon: XCircle,
          iconColor: "text-red-500",
          bgColor: "bg-red-50",
        };
      case "loading":
        return {
          Icon: Loader,
          iconColor: "text-blue-500",
          bgColor: "bg-blue-50",
        };
      default:
        return {
          Icon: CheckCircle,
          iconColor: "text-green-500",
          bgColor: "bg-green-50",
        };
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={type === "loading" ? () => {} : onClose}
      title={title}>
      <div className="mt-0 text-sm text-gray-700">
        <p>{message}</p>
      </div>

      {type !== "loading" && (
        <div className="flex justify-end mt-6">
          <Button type="button" variant="primary" onClick={onClose}>
            {t("okay")}
          </Button>
        </div>
      )}
    </Modal>
  );
}
