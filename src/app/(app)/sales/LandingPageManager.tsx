"use client";

import React, { useState } from "react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import PremiumSelect from "@/components/ui/PremiumSelect";
import { ConfirmDeleteModal } from "@/components/common/ConfirmDeleteModal";
import { createLandingPage, updateLandingPage, deleteLandingPage } from "@/app/(app)/actions/createLandingPage";
import { Globe, Plus, Trash2 } from "lucide-react";

interface LandingPage {
  id: string;
  title: string;
  slug: string;
  content: string;
  ctaText: string;
  ctaLink: string;
  isPublished: boolean;
  campaignId: string | null;
  campaignName: string | null;
  totalVisits: number;
  recentVisits: number;
  createdAt: string;
}

interface Campaign {
  id: string;
  name: string;
}

interface LandingPageManagerProps {
  landingPages: LandingPage[];
  campaigns: Campaign[];
}

export default function LandingPageManager({
  landingPages,
  campaigns,
}: LandingPageManagerProps) {
  const [showModal, setShowModal] = useState(false);
  const [editingPage, setEditingPage] = useState<LandingPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const result = editingPage
      ? await updateLandingPage(editingPage.id, formData)
      : await createLandingPage(formData);

    if (result.error) {
      setError(result.error);
    } else {
      setShowModal(false);
      setEditingPage(null);
    }
    setLoading(false);
  };

  const [pageToDelete, setPageToDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = (id: string) => setPageToDelete(id);

  const confirmDeletePage = async () => {
    if (!pageToDelete) return;
    const id = pageToDelete;
    setPageToDelete(null);
    setDeleteError(null);
    const result = await deleteLandingPage(id);
    if (result.error) setDeleteError(result.error);
  };

  return (
    <div>
      <div className="sl-tab-bar">
        <span className="sl-tab-hint">{landingPages.length} landing pages</span>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => {
            setEditingPage(null);
            setCampaignId("");
            setShowModal(true);
          }}>
          <Plus size={14} /> New page
        </button>
      </div>

      {landingPages.length === 0 ? (
        <div className="dcard sl-empty">
          <Globe size={28} className="sl-empty-icon" />
          <p style={{ fontSize: 14, color: "var(--primary-70)", fontWeight: 500 }}>No landing pages yet</p>
          <p style={{ fontSize: 12.5, color: "var(--primary-50)", marginTop: 4 }}>
            Create your first landing page to start capturing leads.
          </p>
        </div>
      ) : (
        <div className="sl-card-list">
          {landingPages.map((page) => (
            <div key={page.id} className="dcard sl-lp">
              <div className="sl-lp-main">
                <div className="sl-lp-toprow">
                  <h3 className="sl-lp-title">{page.title}</h3>
                  <span
                    className="pill"
                    style={
                      page.isPublished
                        ? { background: "var(--emerald-100)", color: "var(--emerald-800)" }
                        : { background: "var(--slate-100)", color: "var(--slate-700)" }
                    }>
                    <span className="pill-dot" style={{ background: page.isPublished ? "#059669" : "#94a3b8" }} />
                    {page.isPublished ? "Published" : "Draft"}
                  </span>
                </div>
                <div className="sl-lp-meta">
                  <span className="sl-lp-slug">/{page.slug}</span>
                  <span className="sl-lp-visits"><strong>{page.recentVisits.toLocaleString()}</strong> visits · 30d</span>
                  {page.campaignName ? <span>Campaign: {page.campaignName}</span> : null}
                </div>
              </div>
              <div className="sl-lp-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!page.isPublished}
                  onClick={() => window.open(`/p/${page.slug}`, "_blank")}>
                  Open ↗
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setEditingPage(page);
                    setCampaignId(page.campaignId || "");
                    setShowModal(true);
                  }}>
                  Edit
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  style={{ width: 36, height: 36 }}
                  onClick={() => handleDelete(page.id)}
                  aria-label="Delete">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setEditingPage(null);
          setCampaignId("");
          setError(null);
        }}
        title={editingPage ? "Edit Landing Page" : "New Landing Page"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-[350] text-gray-700 mb-1">
              Title
            </label>
            <Input
              name="title"
              defaultValue={editingPage?.title || ""}
              placeholder="Page title"
              required
            />
          </div>

          {!editingPage && (
            <div>
              <label className="block text-sm font-[350] text-gray-700 mb-1">
                URL Slug
              </label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-gray-400">/p/</span>
                <Input
                  name="slug"
                  placeholder="my-landing-page"
                  required
                  className="flex-1"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-[350] text-gray-700 mb-1">
              Content
            </label>
            <Textarea
              name="content"
              defaultValue={editingPage?.content || ""}
              placeholder="Page content (supports basic text)"
              rows={6}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-[350] text-gray-700 mb-1">
                CTA Button Text
              </label>
              <Input
                name="ctaText"
                defaultValue={editingPage?.ctaText || "Get a Free Quote"}
                placeholder="Get a Free Quote"
              />
            </div>
            <div>
              <label className="block text-sm font-[350] text-gray-700 mb-1">
                CTA Link
              </label>
              <Input
                name="ctaLink"
                defaultValue={editingPage?.ctaLink || "/"}
                placeholder="/"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-[350] text-gray-700 mb-1">
              Campaign
            </label>
            <PremiumSelect
              name="campaignId"
              value={campaignId}
              onChange={setCampaignId}
              options={[
                { value: "", label: "No campaign" },
                ...campaigns.map((c) => ({ value: c.id, label: c.name })),
              ]}
              placeholder="No campaign"
              size="md"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              name="isPublished"
              value="true"
              defaultChecked={editingPage?.isPublished || false}
              id="isPublished"
              className="rounded border-gray-300"
            />
            <label
              htmlFor="isPublished"
              className="text-sm font-[350] text-gray-700">
              Publish immediately
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="cancel"
              size="sm"
              onClick={() => {
                setShowModal(false);
                setEditingPage(null);
              }}
              disabled={loading}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="action"
              size="sm"
              disabled={loading}>
              {loading ? "Saving..." : editingPage ? "Update" : "Create Page"}
            </Button>
          </div>
        </form>
      </Modal>

      {deleteError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {deleteError}
        </div>
      )}

      <ConfirmDeleteModal
        isOpen={!!pageToDelete}
        onClose={() => setPageToDelete(null)}
        onConfirm={confirmDeletePage}
        fileName="this landing page"
        title="Delete landing page?"
        message="This action cannot be undone."
      />
    </div>
  );
}
