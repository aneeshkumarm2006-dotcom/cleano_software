"use client";
import React from "react";
import { X, Check, Loader } from "lucide-react";
import Button from "@/components/ui/Button";

interface ConfirmNameChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  oldName: string;
  newName: string;
  isSaving?: boolean;
}

export function ConfirmNameChangeModal({
  isOpen,
  onClose,
  onConfirm,
  oldName,
  newName,
  isSaving = false,
}: ConfirmNameChangeModalProps) {
  if (!isOpen) return null;

  const handleClose = () => {
    if (!isSaving) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      {/* Blurred backdrop */}
      <div
        className="absolute inset-0"
        style={{
          backdropFilter: "blur(2px)",
          backgroundColor: "rgba(175, 175, 175, 0.1)",
        }}
        onClick={handleClose}
      />

      {/* Modal Container */}
      <div className="relative z-[1001] w-full max-w-lg max-h-[95vh] gap-0 bg-white rounded-3xl overflow-hidden">
        {/* Content Section */}
        <section className="w-full bg-[#ffffff]/5 flex items-start justify-center overflow-y-auto">
          <div className="w-full max-w-[80rem] mx-auto px-6 md:px-8 py-6 md:py-8">
            <div className="w-full flex items-start justify-between gap-1 mb-8">
              <div>
                <h1 className="text-3xl font-[350] tracking-tight text-[#005F6A] max-w-[40rem]">
                  Confirm Name Change
                </h1>
                <p className="text-sm text-[#005F6A]/80">
                  Review the changes before confirming
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClose}
                disabled={isSaving}
                className="!p-2">
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="space-y-6">
              <p className="text-sm text-[#005F6A]/80">
                Are you sure you want to change the practice name?
              </p>

              <div className="bg-[#005F6A]/5 rounded-2xl p-4 space-y-3">
                <div>
                  <p className="text-xs text-[#005F6A]/70 mb-1">Current name</p>
                  <p className="text-sm font-[400] text-[#005F6A]">{oldName}</p>
                </div>
                <div>
                  <p className="text-xs text-[#005F6A]/70 mb-1">New name</p>
                  <p className="text-sm font-[400] text-[#005F6A]">{newName}</p>
                </div>
              </div>

              <p className="text-xs text-[#005F6A]/60">
                This name will be visible to all members of the practice.
              </p>

              {/* Action Buttons */}
              <div className="w-full flex justify-center md:justify-end pt-4 border-t">
                <div className="flex gap-3 w-full md:w-auto">
                  <Button
                    type="button"
                    variant="default"
                    size="md"
                    border={false}
                    onClick={handleClose}
                    disabled={isSaving}
                    className="px-6 py-3">
                    Cancel
                  </Button>
                  <Button
                    variant="action"
                    size="md"
                    onClick={onConfirm}
                    disabled={isSaving}
                    className="px-6 py-3">
                    {isSaving ? (
                      <>
                        <Loader className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Confirm Change
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
