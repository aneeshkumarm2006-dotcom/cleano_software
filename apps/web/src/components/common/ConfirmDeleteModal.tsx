"use client";

import React from "react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  fileName?: string;
  title?: string;
  message?: string;
}

export function ConfirmDeleteModal({
  isOpen,
  onClose,
  onConfirm,
  fileName = "item",
  title = "Delete Item",
  message = "This action cannot be undone.",
}: ConfirmDeleteModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-2">{title}</h2>
        <p className="text-sm text-gray-600 mb-4">
          Are you sure you want to delete {fileName}? {message}
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </div>
      </div>
    </Modal>
  );
}
