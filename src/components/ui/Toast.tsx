"use client";

import React, { useEffect, useState } from "react";
import { CheckCircle, XCircle, Loader } from "lucide-react";

interface ToastProps {
  type: "success" | "error" | "loading";
  title: string;
  message: string;
  duration?: number;
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({
  type,
  title,
  message,
  duration = 3000,
  onClose,
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Fade in
    setTimeout(() => setIsVisible(true), 10);

    // Auto close
    if (type !== "loading") {
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(onClose, 300);
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [duration, type, onClose]);

  const getIcon = () => {
    switch (type) {
      case "success":
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case "error":
        return <XCircle className="w-5 h-5 text-red-600" />;
      case "loading":
        return <Loader className="w-5 h-5 text-[#005F6A] animate-spin" />;
    }
  };

  const getBgColor = () => {
    switch (type) {
      case "success":
        return "bg-green-50 border-green-200";
      case "error":
        return "bg-red-50 border-red-200";
      case "loading":
        return "bg-blue-50 border-blue-200";
    }
  };

  return (
    <div
      className={`fixed bottom-6 right-6 z-[9999] transition-all duration-300 ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}>
      <div
        className={`${getBgColor()} border rounded-xl shadow-lg p-4 min-w-[300px] max-w-md`}>
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>
          <div className="flex-1 min-w-0">
            <h4 className="app-title-small !mb-1">{title}</h4>
            <p className="app-subtitle">{message}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export const useToast = () => {
  const [toasts, setToasts] = useState<
    Array<{
      id: string;
      type: "success" | "error" | "loading";
      title: string;
      message: string;
    }>
  >([]);

  const showToast = (
    type: "success" | "error" | "loading",
    title: string,
    message: string
  ) => {
    const id = Math.random().toString(36);
    setToasts((prev) => [...prev, { id, type, title, message }]);
    return id;
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const ToastContainer = () => (
    <>
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          type={toast.type}
          title={toast.title}
          message={toast.message}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </>
  );

  return { showToast, removeToast, ToastContainer };
};
