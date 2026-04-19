"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import { createRagWash } from "../../../actions/createRagWash";
import { updateRagWash, deleteRagWash } from "../../../actions/updateRagWash";
import {
  ArrowLeft,
  Plus,
  Droplets,
  Calendar,
  Pencil,
  Trash2,
} from "lucide-react";

interface WashEntry {
  id: string;
  washDate: string;
  ragCount: number;
  notes: string | null;
}

interface RagWashDetailViewProps {
  employee: { id: string; name: string; email: string };
  washes: WashEntry[];
  totalRags: number;
  totalWashes: number;
}

export default function RagWashDetailView({
  employee,
  washes,
  totalRags,
  totalWashes,
}: RagWashDetailViewProps) {
  const router = useRouter();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingWash, setEditingWash] = useState<WashEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Form state
  const [washDate, setWashDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [ragCount, setRagCount] = useState("1");
  const [notes, setNotes] = useState("");

  const resetForm = () => {
    setWashDate(new Date().toISOString().split("T")[0]);
    setRagCount("1");
    setNotes("");
    setMessage(null);
  };

  const handleAdd = async () => {
    setSaving(true);
    setMessage(null);
    const res = await createRagWash({
      employeeId: employee.id,
      washDate,
      ragCount: parseInt(ragCount) || 0,
      notes: notes || undefined,
    });
    if (res.success) {
      setMessage({ type: "success", text: "Wash entry added." });
      setTimeout(() => {
        setShowAddModal(false);
        resetForm();
        router.refresh();
      }, 600);
    } else {
      setMessage({ type: "error", text: res.error || "Failed to add entry." });
    }
    setSaving(false);
  };

  const handleUpdate = async () => {
    if (!editingWash) return;
    setSaving(true);
    setMessage(null);
    const res = await updateRagWash({
      id: editingWash.id,
      washDate,
      ragCount: parseInt(ragCount) || 0,
      notes: notes || undefined,
    });
    if (res.success) {
      setMessage({ type: "success", text: "Wash entry updated." });
      setTimeout(() => {
        setEditingWash(null);
        resetForm();
        router.refresh();
      }, 600);
    } else {
      setMessage({
        type: "error",
        text: res.error || "Failed to update entry.",
      });
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    const res = await deleteRagWash(id);
    if (res.success) {
      router.refresh();
    }
  };

  const openEditModal = (wash: WashEntry) => {
    setEditingWash(wash);
    setWashDate(new Date(wash.washDate).toISOString().split("T")[0]);
    setRagCount(String(wash.ragCount));
    setNotes(wash.notes || "");
    setMessage(null);
  };

  const avgRagsPerWash =
    totalWashes > 0 ? (totalRags / totalWashes).toFixed(1) : "0";

  const WashForm = ({ onSubmit, submitLabel }: { onSubmit: () => void; submitLabel: string }) => (
    <div className="space-y-4">
      <div>
        <label className="input-label !text-[#005F6A]/70 mb-1 block">
          Wash Date
        </label>
        <Input
          type="date"
          value={washDate}
          onChange={(e) => setWashDate(e.target.value)}
          variant="form"
          border={false}
          size="md"
        />
      </div>
      <div>
        <label className="input-label !text-[#005F6A]/70 mb-1 block">
          Rag Count
        </label>
        <Input
          type="number"
          min="1"
          value={ragCount}
          onChange={(e) => setRagCount(e.target.value)}
          placeholder="Number of rags washed"
          variant="form"
          border={false}
          size="md"
        />
      </div>
      <div>
        <label className="input-label !text-[#005F6A]/70 mb-1 block">
          Notes (optional)
        </label>
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any additional notes..."
          variant="form"
          border={false}
          size="md"
        />
      </div>

      {message && (
        <div
          className={`p-3 rounded-xl text-sm ${
            message.type === "success"
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}>
          {message.text}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button
          variant="default"
          size="md"
          border={false}
          onClick={() => {
            setShowAddModal(false);
            setEditingWash(null);
            resetForm();
          }}
          className="px-6 py-3">
          Cancel
        </Button>
        <Button
          variant="primary"
          size="md"
          border={false}
          onClick={onSubmit}
          disabled={saving}
          className="px-6 py-3">
          {saving ? "Saving..." : submitLabel}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="max-w-[80rem] mx-auto space-y-6">
      {/* Back Button */}
      <Button
        variant="default"
        size="sm"
        border={false}
        onClick={() => router.push("/inventory/rag-wash")}
        className="mb-2 px-6 py-3">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Rag Wash
      </Button>

      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl !font-light tracking-tight text-[#005F6A]">
            {employee.name}
          </h1>
          <p className="text-sm text-[#005F6A]/70 !font-light mt-1">
            Rag wash history
          </p>
        </div>
        <Button
          variant="primary"
          size="md"
          border={false}
          onClick={() => {
            resetForm();
            setShowAddModal(true);
          }}
          className="px-6 py-3">
          <Plus className="w-4 h-4 mr-2" />
          Add Wash Entry
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card variant="cleano_light" className="p-6 h-[7rem]">
          <div className="h-full flex flex-col justify-between">
            <span className="app-title-small !text-[#005F6A]/70">
              Total Washes
            </span>
            <p className="h2-title text-[#005F6A]">{totalWashes}</p>
          </div>
        </Card>
        <Card variant="cleano_light" className="p-6 h-[7rem]">
          <div className="h-full flex flex-col justify-between">
            <span className="app-title-small !text-[#005F6A]/70">
              Total Rags
            </span>
            <p className="h2-title text-[#005F6A]">{totalRags}</p>
          </div>
        </Card>
        <Card variant="cleano_light" className="p-6 h-[7rem]">
          <div className="h-full flex flex-col justify-between">
            <span className="app-title-small !text-[#005F6A]/70">
              Avg Rags/Wash
            </span>
            <p className="h2-title text-[#005F6A]">{avgRagsPerWash}</p>
          </div>
        </Card>
      </div>

      {/* Wash History */}
      <div className="space-y-4">
        <h2 className="text-lg font-[350] tracking-tight text-[#005F6A]">
          Wash History
        </h2>

        {washes.length === 0 ? (
          <Card variant="ghost" className="p-8">
            <div className="text-center">
              <div className="w-12 h-12 bg-[#005F6A]/5 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Droplets className="w-6 h-6 text-[#005F6A]/40" />
              </div>
              <p className="text-sm text-[#005F6A]/60">No wash entries yet</p>
              <p className="text-xs text-[#005F6A]/40 mt-1">
                Click &ldquo;Add Wash Entry&rdquo; to record a rag wash
              </p>
            </div>
          </Card>
        ) : (
          <div className="space-y-2">
            {washes.map((wash) => (
              <div
                key={wash.id}
                className="flex items-center justify-between p-4 rounded-xl bg-[#005F6A]/5 hover:bg-[#005F6A]/8 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-[#005F6A]/10 rounded-lg">
                    <Calendar className="w-4 h-4 text-[#005F6A]" />
                  </div>
                  <div>
                    <p className="text-sm font-[400] text-[#005F6A]">
                      {new Date(wash.washDate).toLocaleDateString("en-US", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </p>
                    {wash.notes && (
                      <p className="text-xs text-[#005F6A]/50 mt-0.5">
                        {wash.notes}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="cleano" size="sm">
                    {wash.ragCount} rag{wash.ragCount !== 1 ? "s" : ""}
                  </Badge>
                  <Button
                    variant="default"
                    size="sm"
                    border={false}
                    onClick={() => openEditModal(wash)}
                    className="rounded-2xl px-3 py-2">
                    <Pencil className="w-3 h-3" />
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    border={false}
                    onClick={() => handleDelete(wash.id)}
                    className="rounded-2xl px-3 py-2 text-red-500 hover:text-red-700">
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => {
          setShowAddModal(false);
          resetForm();
        }}
        title="Add Wash Entry">
        <WashForm onSubmit={handleAdd} submitLabel="Add Entry" />
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={!!editingWash}
        onClose={() => {
          setEditingWash(null);
          resetForm();
        }}
        title="Edit Wash Entry">
        <WashForm onSubmit={handleUpdate} submitLabel="Update Entry" />
      </Modal>
    </div>
  );
}
