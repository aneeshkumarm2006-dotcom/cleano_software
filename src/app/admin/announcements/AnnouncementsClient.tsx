"use client";

import React, { useState } from "react";
import {
  MessageCircle,
  Sparkles,
  Plus,
  Check,
  Pin,
  Pencil,
  Trash2,
  Heart,
} from "lucide-react";
import useSWR from "swr";
import { initials } from "@/lib/avatar";
import AdminModal from "@/components/ui/AdminModal";
import {
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  togglePin,
  reactToAnnouncement,
  type AnnouncementDTO,
} from "./announcements";

interface AnnouncementsClientProps {
  initial: AnnouncementDTO[];
  /** Admin/office users can publish, edit, pin, and delete. */
  canManage: boolean;
}

// Must match REACTION_EMOJIS on the server.
const REACTION_SET = ["👍", "🎉", "❤️"];

function formatAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h <= 0) {
    const m = Math.floor(ms / 60_000);
    return m <= 1 ? "Just now" : `${m}m ago`;
  }
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function Avatar({ name, size }: { name: string; size: number }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.34, border: 0, background: "var(--primary)" }}>
      {initials(name)}
    </span>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field" style={{ marginBottom: 14 }}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
  up,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint: string;
  up?: boolean;
}) {
  return (
    <div className="astat">
      <div className="astat-head">
        <span>{label}</span>
        <span className="astat-icon">{icon}</span>
      </div>
      <div className="astat-value">{value}</div>
      <div className={`astat-delta ${up ? "up" : ""}`}>{hint}</div>
    </div>
  );
}

function ComposeModal({
  editing,
  onClose,
  onSave,
}: {
  editing: AnnouncementDTO | null;
  onClose: () => void;
  onSave: (a: {
    title: string;
    body: string;
    pinned: boolean;
  }) => Promise<string | null>;
}) {
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [pinned, setPinned] = useState(editing?.pinned ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = title.trim() && body.trim();

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    const err = await onSave({ title: title.trim(), body: body.trim(), pinned });
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    onClose();
  }

  return (
    <AdminModal
      open
      title={editing ? "Edit announcement" : "New announcement"}
      subtitle={
        editing
          ? "Changes are visible to the whole team immediately."
          : "Posts to the team hub for all cleaners and staff."
      }
      onClose={onClose}
      width={540}
      footer={
        <>
          <label className="an-pin-toggle" onClick={() => setPinned((p) => !p)}>
            <span className={`an-pin-check ${pinned ? "on" : ""}`}>
              {pinned ? <Check size={12} /> : null}
            </span>
            <Pin size={13} /> Pin to top
          </label>
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={save}
            disabled={!valid || saving}>
            {saving ? "Saving…" : editing ? "Save changes" : "Publish"}
          </button>
        </>
      }>
      {error && (
        <div
          style={{
            fontSize: 13,
            color: "#dc2626",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 8,
            padding: "8px 12px",
            marginBottom: 12,
          }}>
          {error}
        </div>
      )}
      <Field label="Title">
        <input
          className="input aselect"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Holiday schedule changes"
          maxLength={120}
          autoFocus
        />
      </Field>
      <Field label="Message">
        <textarea
          className="textarea"
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your announcement…"
          maxLength={5000}
        />
      </Field>
    </AdminModal>
  );
}

function AnnouncementCard({
  a,
  canManage,
  onTogglePin,
  onReact,
  onEdit,
  onDelete,
}: {
  a: AnnouncementDTO;
  canManage: boolean;
  onTogglePin: (id: string) => void;
  onReact: (id: string, emoji: string) => void;
  onEdit: (a: AnnouncementDTO) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <article className={`an-card ${a.pinned ? "pinned" : ""}`}>
      <div className="an-card-head">
        <Avatar name={a.authorName} size={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="an-author">{a.authorName}</span>
          </div>
          <div className="an-time">{formatAgo(a.createdAt)}</div>
        </div>
        {a.pinned ? (
          <span className="an-pinned-badge">
            <Pin size={12} /> Pinned
          </span>
        ) : null}
        {canManage && (
          <>
            <button
              className="icon-btn"
              style={{ width: 30, height: 30 }}
              title={a.pinned ? "Unpin" : "Pin"}
              onClick={() => onTogglePin(a.id)}>
              <Pin size={13} />
            </button>
            <button
              className="icon-btn"
              style={{ width: 30, height: 30 }}
              title="Edit"
              onClick={() => onEdit(a)}>
              <Pencil size={13} />
            </button>
            <button
              className="icon-btn"
              style={{ width: 30, height: 30 }}
              title="Delete"
              onClick={() => onDelete(a.id)}>
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>

      <h3 className="an-title">{a.title}</h3>
      <p className="an-body" style={{ whiteSpace: "pre-wrap" }}>{a.body}</p>

      <div className="an-foot">
        <div className="an-reactions">
          {REACTION_SET.map((e) => {
            const n = a.reactions[e] || 0;
            const mine = a.myReaction === e;
            return (
              <button
                key={e}
                className={`an-react ${n ? "has" : ""}`}
                title={mine ? "Remove your reaction" : "React"}
                style={mine ? { borderColor: "var(--primary)", background: "var(--primary-5)" } : undefined}
                onClick={() => onReact(a.id, e)}>
                <span style={{ fontSize: 14 }}>{e}</span>
                {n ? <span className="an-react-n">{n}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </article>
  );
}

export default function AnnouncementsClient({
  initial,
  canManage,
}: AnnouncementsClientProps) {
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<AnnouncementDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, mutate } = useSWR<AnnouncementDTO[]>(
    "announcements",
    async () => {
      const res = await listAnnouncements();
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    { fallbackData: initial, refreshInterval: 30000 }
  );

  const items = data ?? initial;
  const pinnedCount = items.filter((a) => a.pinned).length;
  const totalReactions = items.reduce(
    (sum, a) => sum + Object.values(a.reactions).reduce((s, n) => s + n, 0),
    0
  );

  async function handleSave(input: {
    title: string;
    body: string;
    pinned: boolean;
  }): Promise<string | null> {
    const res = editing
      ? await updateAnnouncement(editing.id, input)
      : await createAnnouncement(input);
    if (!res.success) return res.error;
    await mutate();
    return null;
  }

  async function handleTogglePin(id: string) {
    setError(null);
    // Optimistic flip, reconciled by the revalidate below.
    await mutate(
      (cur) => cur?.map((a) => (a.id === id ? { ...a, pinned: !a.pinned } : a)),
      { revalidate: false }
    );
    const res = await togglePin(id);
    if (!res.success) setError(res.error);
    await mutate();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this announcement? The team will no longer see it.")) return;
    setError(null);
    await mutate((cur) => cur?.filter((a) => a.id !== id), { revalidate: false });
    const res = await deleteAnnouncement(id);
    if (!res.success) setError(res.error);
    await mutate();
  }

  async function handleReact(id: string, emoji: string) {
    setError(null);
    // Optimistic single-reaction semantics: same emoji toggles off, a
    // different one switches. Reconciled with the action's fresh counts.
    await mutate(
      (cur) =>
        cur?.map((a) => {
          if (a.id !== id) return a;
          const reactions = { ...a.reactions };
          if (a.myReaction) {
            reactions[a.myReaction] = Math.max(0, (reactions[a.myReaction] || 1) - 1);
            if (!reactions[a.myReaction]) delete reactions[a.myReaction];
          }
          if (a.myReaction === emoji) {
            return { ...a, reactions, myReaction: null };
          }
          reactions[emoji] = (reactions[emoji] || 0) + 1;
          return { ...a, reactions, myReaction: emoji };
        }),
      { revalidate: false }
    );
    const res = await reactToAnnouncement(id, emoji);
    if (!res.success) {
      setError(res.error);
      await mutate();
      return;
    }
    await mutate(
      (cur) =>
        cur?.map((a) =>
          a.id === id
            ? { ...a, reactions: res.data.reactions, myReaction: res.data.myReaction }
            : a
        ),
      { revalidate: false }
    );
  }

  return (
    <div className="admin-font">
      <header
        className="row-between"
        style={{ marginBottom: 24, alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="stack-8">
          <p className="eyebrow">Team hub</p>
          <h1 className="display" style={{ fontSize: "clamp(30px, 3.6vw, 42px)", whiteSpace: "nowrap" }}>
            Announcements
          </h1>
        </div>
        {canManage && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditing(null);
              setComposing(true);
            }}>
            <Plus size={15} /> New announcement
          </button>
        )}
      </header>

      {error && (
        <div
          style={{
            fontSize: 13,
            color: "#dc2626",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 8,
            padding: "8px 12px",
            marginBottom: 16,
          }}>
          {error}
        </div>
      )}

      <div
        className="astat-grid"
        style={{ marginBottom: 26, gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
        <Stat icon={<MessageCircle size={16} />} label="Posts" value={items.length} hint="visible to the team" />
        <Stat icon={<Sparkles size={16} />} label="Pinned" value={pinnedCount} hint="kept at the top" />
        <Stat icon={<Heart size={16} />} label="Reactions" value={totalReactions} hint="from the crew" up={totalReactions > 0} />
      </div>

      <div className="an-feed">
        {items.length === 0 ? (
          <div
            className="an-card"
            style={{ textAlign: "center", color: "var(--primary-50)", fontSize: 14 }}>
            No announcements yet.
            {canManage ? " Publish the first one to keep the crew in the loop." : ""}
          </div>
        ) : (
          items.map((a) => (
            <AnnouncementCard
              key={a.id}
              a={a}
              canManage={canManage}
              onTogglePin={handleTogglePin}
              onReact={handleReact}
              onEdit={(an) => {
                setEditing(an);
                setComposing(true);
              }}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>

      {composing ? (
        <ComposeModal
          editing={editing}
          onClose={() => {
            setComposing(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      ) : null}
    </div>
  );
}
