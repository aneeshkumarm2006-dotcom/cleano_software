"use client";

import React, { useState } from "react";
import Modal from "@/components/ui/Modal";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import PremiumSelect from "@/components/ui/PremiumSelect";
import DatePicker from "@/components/ui/DatePicker";
import { ConfirmDeleteModal } from "@/components/common/ConfirmDeleteModal";
import { createSalesArea } from "@/app/admin/actions/createSalesArea";
import { updateSalesArea, deleteSalesArea } from "@/app/admin/actions/updateSalesArea";

const SALES_AREA_TYPES = [
  { value: "DOOR_KNOCK", label: "Door Knock" },
  { value: "FLYER_DROP", label: "Flyer Drop" },
  { value: "REFERRAL", label: "Referral" },
  { value: "ONLINE_AD", label: "Online Ad" },
  { value: "SOCIAL_MEDIA", label: "Social Media" },
  { value: "OTHER", label: "Other" },
];

interface SalesArea {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  address: string | null;
  notes: string | null;
  date: string;
  createdAt: string;
}

interface SalesAreaModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingArea?: SalesArea | null;
}

export default function SalesAreaModal({
  isOpen,
  onClose,
  editingArea,
}: SalesAreaModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [areaType, setAreaType] = useState(editingArea?.type || "DOOR_KNOCK");
  const [areaDate, setAreaDate] = useState(
    editingArea?.date
      ? new Date(editingArea.date).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0]
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result = editingArea
      ? await updateSalesArea(editingArea.id, formData)
      : await createSalesArea(formData);

    if (result.error) {
      setError(result.error);
      setLoading(false);
    } else {
      setLoading(false);
      onClose();
    }
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = () => {
    if (!editingArea) return;
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!editingArea) return;
    setShowDeleteConfirm(false);
    setLoading(true);
    const result = await deleteSalesArea(editingArea.id);
    if (result.error) {
      setError(result.error);
    } else {
      onClose();
    }
    setLoading(false);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingArea ? "Edit Sales Area" : "Add Sales Area"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-[350] text-gray-700 mb-1">
            Name
          </label>
          <Input
            name="name"
            defaultValue={editingArea?.name || ""}
            placeholder="e.g. Westmount Neighborhood"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-[350] text-gray-700 mb-1">
            Type
          </label>
          <PremiumSelect
            name="type"
            value={areaType}
            onChange={setAreaType}
            options={SALES_AREA_TYPES.map((t) => ({ value: t.value, label: t.label }))}
            size="md"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-[350] text-gray-700 mb-1">
              Latitude
            </label>
            <Input
              name="latitude"
              type="number"
              step="any"
              defaultValue={editingArea?.latitude || ""}
              placeholder="45.5017"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-[350] text-gray-700 mb-1">
              Longitude
            </label>
            <Input
              name="longitude"
              type="number"
              step="any"
              defaultValue={editingArea?.longitude || ""}
              placeholder="-73.5673"
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-[350] text-gray-700 mb-1">
            Address
          </label>
          <Input
            name="address"
            defaultValue={editingArea?.address || ""}
            placeholder="Street address (optional)"
          />
        </div>

        <div>
          <label className="block text-sm font-[350] text-gray-700 mb-1">
            Date
          </label>
          <DatePicker
            name="date"
            value={areaDate}
            onChange={setAreaDate}
            size="md"
          />
        </div>

        <div>
          <label className="block text-sm font-[350] text-gray-700 mb-1">
            Notes
          </label>
          <Textarea
            name="notes"
            defaultValue={editingArea?.notes || ""}
            placeholder="Any notes about this area..."
            rows={3}
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <div>
            {editingArea && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={loading}
                className="text-red-500 hover:text-red-700">
                Delete
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="cancel"
              size="sm"
              onClick={onClose}
              disabled={loading}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="action"
              size="sm"
              disabled={loading}>
              {loading
                ? "Saving..."
                : editingArea
                  ? "Update"
                  : "Add Area"}
            </Button>
          </div>
        </div>
      </form>

      <ConfirmDeleteModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={confirmDelete}
        fileName="this sales area"
        title="Delete sales area?"
        message="This action cannot be undone."
      />
    </Modal>
  );
}
