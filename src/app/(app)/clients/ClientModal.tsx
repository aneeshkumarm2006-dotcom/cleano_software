"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  User,
  Mail,
  Phone,
  MapPin,
  FileText,
  Loader,
  Check,
  Percent,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { createClient } from "../actions/createClient";
import { updateClient } from "../actions/updateClient";

interface ClientLite {
  id: string;
  name: string;
  email: string | null;
  secondaryEmail?: string | null;
  phone: string | null;
  secondaryPhone?: string | null;
  address: string | null;
  notes: string | null;
  discountPercent?: number | null;
}

interface ClientModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  client?: ClientLite | null;
}

export default function ClientModal({
  isOpen,
  onClose,
  mode,
  client,
}: ClientModalProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [secondaryEmail, setSecondaryEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [secondaryPhone, setSecondaryPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [discountPercent, setDiscountPercent] = useState("");

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccess(false);
      setName(client?.name || "");
      setEmail(client?.email || "");
      setSecondaryEmail(client?.secondaryEmail || "");
      setPhone(client?.phone || "");
      setSecondaryPhone(client?.secondaryPhone || "");
      setAddress(client?.address || "");
      setNotes(client?.notes || "");
      setDiscountPercent(
        client?.discountPercent != null && client.discountPercent > 0
          ? String(client.discountPercent)
          : ""
      );
    }
  }, [isOpen, client]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    setError(null);

    const fd = new FormData();
    fd.append("name", name);
    fd.append("email", email);
    fd.append("secondaryEmail", secondaryEmail);
    fd.append("phone", phone);
    fd.append("secondaryPhone", secondaryPhone);
    fd.append("address", address);
    fd.append("notes", notes);
    fd.append("discountPercent", discountPercent);

    let result;
    if (mode === "edit" && client) {
      fd.append("id", client.id);
      result = await updateClient(fd);
    } else {
      result = await createClient(fd);
    }

    setSubmitting(false);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccess(true);
      setTimeout(() => {
        onClose();
        router.refresh();
      }, 600);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div
        className="absolute inset-0"
        style={{
          backdropFilter: "blur(2px)",
          backgroundColor: "rgba(175, 175, 175, 0.1)",
        }}
        onClick={() => !submitting && onClose()}
      />
      <div className="relative z-[1001] w-full max-w-lg max-h-[95vh] bg-white rounded-3xl overflow-y-auto">
        <div className="px-6 md:px-8 py-6 md:py-8">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-[350] tracking-tight text-[#005F6A]">
                {mode === "create" ? "New Client" : "Edit Client"}
              </h1>
              <p className="text-sm text-[#005F6A]/60 mt-1">
                {mode === "create"
                  ? "Add a new client to your roster"
                  : "Update client information"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={submitting}
              className="!p-2">
              <X className="w-5 h-5" />
            </Button>
          </div>

          {success && (
            <div className="rounded-2xl p-4 flex items-start gap-3 bg-green-50 border border-green-200 mb-6">
              <Check className="w-5 h-5 text-green-600 mt-0.5" />
              <p className="text-sm text-green-700 font-[400]">
                Client {mode === "create" ? "created" : "updated"} successfully
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="input-label tracking-tight">
                Name <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                <Input
                  variant="form"
                  size="md"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={submitting}
                  className="w-full pl-11 px-4 py-3"
                  placeholder="Client name"
                  border={false}
                />
              </div>
            </div>

            <div>
              <label className="input-label tracking-tight">Email</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                <Input
                  variant="form"
                  type="email"
                  size="md"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={submitting}
                  className="w-full pl-11 px-4 py-3"
                  placeholder="client@example.com"
                  border={false}
                />
              </div>
            </div>

            <div>
              <label className="input-label tracking-tight">Secondary email</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/30" />
                <Input
                  variant="form"
                  type="email"
                  size="md"
                  value={secondaryEmail}
                  onChange={(e) => setSecondaryEmail(e.target.value)}
                  disabled={submitting}
                  className="w-full pl-11 px-4 py-3"
                  placeholder="cc@example.com (optional)"
                  border={false}
                />
              </div>
            </div>

            <div>
              <label className="input-label tracking-tight">Phone</label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                <Input
                  variant="form"
                  size="md"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={submitting}
                  className="w-full pl-11 px-4 py-3"
                  placeholder="(555) 123-4567"
                  border={false}
                />
              </div>
            </div>

            <div>
              <label className="input-label tracking-tight">Secondary phone</label>
              <div className="relative">
                <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/30" />
                <Input
                  variant="form"
                  size="md"
                  value={secondaryPhone}
                  onChange={(e) => setSecondaryPhone(e.target.value)}
                  disabled={submitting}
                  className="w-full pl-11 px-4 py-3"
                  placeholder="(555) 987-6543 (optional)"
                  border={false}
                />
              </div>
            </div>

            <div>
              <label className="input-label tracking-tight">Address</label>
              <div className="relative">
                <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                <Input
                  variant="form"
                  size="md"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  disabled={submitting}
                  className="w-full pl-11 px-4 py-3"
                  placeholder="Street, City"
                  border={false}
                />
              </div>
            </div>

            <div>
              <label className="input-label tracking-tight">
                Default Discount (%)
              </label>
              <div className="relative">
                <Percent className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 z-10 text-[#005F6A]/50" />
                <Input
                  variant="form"
                  type="number"
                  size="md"
                  min={0}
                  max={100}
                  step="0.01"
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(e.target.value)}
                  disabled={submitting}
                  className="w-full pl-11 px-4 py-3"
                  placeholder="0"
                  border={false}
                />
              </div>
              <p className="text-[11px] text-[#005F6A]/50 mt-1">
                Auto-applied to this client&apos;s jobs and invoices. Leave 0
                for none.
              </p>
            </div>

            <div>
              <label className="input-label tracking-tight">Notes</label>
              <Textarea
                size="md"
                variant="form"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={submitting}
                className="w-full px-4 py-3"
                placeholder="Any additional notes..."
                rows={3}
              />
            </div>

            {error && (
              <div className="bg-red-50 rounded-2xl p-3">
                <p className="text-xs text-red-600">{error}</p>
              </div>
            )}

            <div className="flex gap-3 justify-end pt-2">
              <Button
                type="button"
                variant="default"
                size="md"
                border={false}
                onClick={onClose}
                disabled={submitting}
                className="px-5 py-3">
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={submitting}
                className="px-6 py-3">
                {submitting ? (
                  <>
                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                    {mode === "create" ? "Creating..." : "Saving..."}
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    {mode === "create" ? "Create Client" : "Save"}
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
