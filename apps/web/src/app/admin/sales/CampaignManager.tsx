"use client";

import React, { useState } from "react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import PremiumSelect from "@/components/ui/PremiumSelect";
import DatePicker from "@/components/ui/DatePicker";
import { createMarketingCampaign } from "@/app/admin/actions/createMarketingCampaign";
import {
  updateMarketingCampaign,
  deleteMarketingCampaign,
} from "@/app/admin/actions/updateMarketingCampaign";
import { Megaphone, Plus, Trash2 } from "lucide-react";
import { campaignStatusStyle } from "./salesTypes";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const shortDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const CAMPAIGN_STATUSES = [
  { value: "DRAFT", label: "Draft" },
  { value: "ACTIVE", label: "Active" },
  { value: "PAUSED", label: "Paused" },
  { value: "COMPLETED", label: "Completed" },
];

const CHANNELS = [
  "Social Media",
  "Email",
  "Door-to-Door",
  "Flyers",
  "Google Ads",
  "Referral Program",
  "Other",
];

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: string;
  budget: number;
  spent: number;
  startDate: string | null;
  endDate: string | null;
  channel: string | null;
  notes: string | null;
  landingPageCount: number;
  createdAt: string;
}

interface CampaignManagerProps {
  campaigns: Campaign[];
}

export default function CampaignManager({ campaigns }: CampaignManagerProps) {
  const [showModal, setShowModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Controlled state for form selects/dates
  const [formStatus, setFormStatus] = useState("DRAFT");
  const [formChannel, setFormChannel] = useState("");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result = editingCampaign
      ? await updateMarketingCampaign(editingCampaign.id, formData)
      : await createMarketingCampaign(formData);

    if (result.error) {
      setError(result.error);
    } else {
      setShowModal(false);
      setEditingCampaign(null);
    }
    setLoading(false);
  };

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await deleteMarketingCampaign(confirmDeleteId);
    setDeleting(false);
    if (result.error) {
      setDeleteError(result.error);
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(null);
    }
  };

  return (
    <div>
      <div className="sl-tab-bar">
        <span className="sl-tab-hint">{campaigns.length} campaigns</span>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => {
            setEditingCampaign(null);
            setFormStatus("DRAFT");
            setFormChannel("");
            setFormStartDate("");
            setFormEndDate("");
            setShowModal(true);
          }}>
          <Plus size={14} /> New campaign
        </button>
      </div>

      {deleteError && (
        <div className="banner banner-amber" style={{ marginBottom: 14 }}>
          {deleteError}
        </div>
      )}

      {campaigns.length === 0 ? (
        <div className="dcard sl-empty">
          <Megaphone size={28} className="sl-empty-icon" />
          <p style={{ fontSize: 14, color: "var(--primary-70)", fontWeight: 500 }}>No campaigns yet</p>
          <p style={{ fontSize: 12.5, color: "var(--primary-50)", marginTop: 4 }}>
            Create your first marketing campaign to start tracking performance.
          </p>
        </div>
      ) : (
        <div className="sl-card-list">
          {campaigns.map((campaign) => {
            const pct =
              campaign.budget > 0
                ? Math.min(100, Math.round((campaign.spent / campaign.budget) * 100))
                : 0;
            const st = campaignStatusStyle(campaign.status);
            if (confirmDeleteId === campaign.id) {
              return (
                <div key={campaign.id} className="dcard" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <div>
                    <div className="sl-lp-title">Delete &ldquo;{campaign.name}&rdquo;?</div>
                    <div style={{ fontSize: 12.5, color: "var(--primary-50)", marginTop: 4 }}>This cannot be undone.</div>
                  </div>
                  <div className="sl-camp-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDeleteId(null)} disabled={deleting}>Cancel</button>
                    <button type="button" className="btn btn-danger-ghost btn-sm" onClick={handleDelete} disabled={deleting}>{deleting ? "Deleting…" : "Delete"}</button>
                  </div>
                </div>
              );
            }
            return (
              <div key={campaign.id} className="dcard sl-camp">
                <div className="sl-camp-head">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="sl-camp-toprow">
                      <h3 className="sl-lp-title">{campaign.name}</h3>
                      <span className="pill" style={{ background: st.bg, color: st.fg }}>
                        <span className="pill-dot" style={{ background: st.dot }} />
                        {st.label}
                      </span>
                    </div>
                    <div className="sl-camp-meta">
                      {[
                        campaign.channel,
                        campaign.startDate
                          ? `${shortDate(campaign.startDate)}${campaign.endDate ? `–${shortDate(campaign.endDate)}` : ""}`
                          : null,
                        `${campaign.landingPageCount} landing page${campaign.landingPageCount !== 1 ? "s" : ""}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div className="sl-camp-actions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setEditingCampaign(campaign);
                        setFormStatus(campaign.status || "DRAFT");
                        setFormChannel(campaign.channel || "");
                        setFormStartDate(campaign.startDate ? new Date(campaign.startDate).toISOString().split("T")[0] : "");
                        setFormEndDate(campaign.endDate ? new Date(campaign.endDate).toISOString().split("T")[0] : "");
                        setShowModal(true);
                      }}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ width: 36, height: 36 }}
                      onClick={() => setConfirmDeleteId(campaign.id)}
                      aria-label="Delete">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                {campaign.budget > 0 && (
                  <div className="sl-budget">
                    <div className="sl-budget-row">
                      <span>{money(campaign.spent)} spent</span>
                      <span style={{ color: "var(--primary-50)" }}>of {money(campaign.budget)}</span>
                    </div>
                    <div className="sl-budget-track">
                      <div
                        className="sl-budget-fill"
                        style={{ width: pct + "%", background: pct >= 100 ? "var(--amber-600)" : "var(--primary)" }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setEditingCampaign(null);
          setError(null);
          setFormStatus("DRAFT");
          setFormChannel("");
          setFormStartDate("");
          setFormEndDate("");
        }}
        title={editingCampaign ? "Edit Campaign" : "New Campaign"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-[350] text-gray-700 mb-1">
              Campaign Name
            </label>
            <Input
              name="name"
              defaultValue={editingCampaign?.name || ""}
              placeholder="e.g. Spring Cleaning Promo"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-[350] text-gray-700 mb-1">
              Description
            </label>
            <Textarea
              name="description"
              defaultValue={editingCampaign?.description || ""}
              placeholder="Campaign description..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-[350] text-gray-700 mb-1">Status</label>
              <PremiumSelect
                name="status"
                value={formStatus}
                onChange={setFormStatus}
                options={CAMPAIGN_STATUSES}
                size="md"
              />
            </div>
            <div>
              <label className="block text-sm font-[350] text-gray-700 mb-1">Channel</label>
              <PremiumSelect
                name="channel"
                value={formChannel}
                onChange={setFormChannel}
                placeholder="Select channel"
                options={[{ value: "", label: "No channel" }, ...CHANNELS.map(ch => ({ value: ch, label: ch }))]}
                size="md"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-[350] text-gray-700 mb-1">
                Budget ($)
              </label>
              <Input
                name="budget"
                type="number"
                step="0.01"
                defaultValue={editingCampaign?.budget || "0"}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-[350] text-gray-700 mb-1">
                Spent ($)
              </label>
              <Input
                name="spent"
                type="number"
                step="0.01"
                defaultValue={editingCampaign?.spent || "0"}
                placeholder="0.00"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-[350] text-gray-700 mb-1">Start Date</label>
              <DatePicker name="startDate" value={formStartDate} onChange={setFormStartDate} size="md" />
            </div>
            <div>
              <label className="block text-sm font-[350] text-gray-700 mb-1">End Date</label>
              <DatePicker name="endDate" value={formEndDate} onChange={setFormEndDate} size="md" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-[350] text-gray-700 mb-1">
              Notes
            </label>
            <Textarea
              name="notes"
              defaultValue={editingCampaign?.notes || ""}
              placeholder="Additional notes..."
              rows={2}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="cancel"
              size="sm"
              onClick={() => {
                setShowModal(false);
                setEditingCampaign(null);
              }}
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
                : editingCampaign
                  ? "Update"
                  : "Create Campaign"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
