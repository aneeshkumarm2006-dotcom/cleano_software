"use client";

import React, { useState } from "react";
import {
  MessageCircle,
  AlertCircle,
  Sparkles,
  Plus,
  Check,
  Pin,
} from "lucide-react";
import { initials } from "@/lib/avatar";
import AdminModal from "@/components/ui/AdminModal";

interface Announcement {
  id: string;
  pinned: boolean;
  audience: string;
  author: string;
  hoursAgo: number;
  unread: boolean;
  title: string;
  body: string;
  reactions: Record<string, number>;
  acked: number;
  total: number;
  youAcked?: boolean;
}

const AUDIENCE = [
  { id: "all", label: "All cleaners" },
  { id: "leads", label: "Lead cleaners" },
  { id: "trainees", label: "Trainees" },
  { id: "office", label: "Office / dispatch" },
];
const audienceLabel = (id: string) =>
  (AUDIENCE.find((a) => a.id === id) || AUDIENCE[0]).label;

const REACTION_SET = ["👍", "🎉", "❤️"];

const INITIAL: Announcement[] = [
  {
    id: "AN-5", pinned: true, audience: "all", author: "Diane Moreau", hoursAgo: 5, unread: true,
    title: "New supply pickup hours start Monday",
    body: "The supply room is now open 7:00–9:30 AM on weekdays only. Please grab your rags and refills before your first job. Weekend pickups move to the Friday window.",
    reactions: { "👍": 6, "🎉": 2 }, acked: 4, total: 12,
  },
  {
    id: "AN-4", pinned: false, audience: "leads", author: "Karim Benali", hoursAgo: 28, unread: true,
    title: "Lead cleaners: new quality checklist",
    body: "We added 4 items to the move-out checklist (baseboards, inside window tracks, range hood filter, balcony sweep). Please review before your next move-out clean.",
    reactions: { "👍": 3 }, acked: 2, total: 4,
  },
  {
    id: "AN-3", pinned: false, audience: "all", author: "Diane Moreau", hoursAgo: 72, unread: false,
    title: "Welcome Noémie to the crew! 🎉",
    body: "Noémie joins us as a lead cleaner this week. Say hi if you see her on a shared job — she is shadowing Camille through Friday.",
    reactions: { "🎉": 9, "👍": 5, "❤️": 4 }, acked: 11, total: 12,
  },
  {
    id: "AN-2", pinned: false, audience: "all", author: "Diane Moreau", hoursAgo: 140, unread: false,
    title: "Reminder: log rag washes for payout",
    body: "Don't forget to log your rag washes in the app — each logged wash adds $0.50 to your next payout. Unlogged washes can't be reimbursed.",
    reactions: { "👍": 7 }, acked: 9, total: 12,
  },
];

function formatAgo(h: number) {
  if (h <= 0) return "Just now";
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
  onClose,
  onPublish,
}: {
  onClose: () => void;
  onPublish: (a: { title: string; body: string; pinned: boolean; audience: string }) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [audience, setAudience] = useState("all");

  const valid = title.trim() && body.trim();

  function publish() {
    if (!valid) return;
    onPublish({ title: title.trim(), body: body.trim(), pinned, audience });
    onClose();
  }

  return (
    <AdminModal
      open
      title="New announcement"
      subtitle="Posts to the team hub and notifies the chosen audience."
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
          <button className="btn btn-primary btn-sm" onClick={publish} disabled={!valid}>
            Publish
          </button>
        </>
      }>
      <Field label="Title">
        <input
          className="input aselect"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Holiday schedule changes"
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
        />
      </Field>
      <Field label="Audience">
        <select
          className="aselect"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}>
          {AUDIENCE.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>
    </AdminModal>
  );
}

function AnnouncementCard({
  a,
  onMarkRead,
  onTogglePin,
  onReact,
  onAck,
}: {
  a: Announcement;
  onMarkRead: (id: string) => void;
  onTogglePin: (id: string) => void;
  onReact: (id: string, emoji: string) => void;
  onAck: (id: string) => void;
}) {
  return (
    <article
      className={`an-card ${a.pinned ? "pinned" : ""}`}
      onMouseEnter={() => a.unread && onMarkRead(a.id)}>
      <div className="an-card-head">
        <Avatar name={a.author} size={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="an-author">{a.author}</span>
            <span className="an-aud">{audienceLabel(a.audience)}</span>
            {a.unread ? <span className="an-new">New</span> : null}
          </div>
          <div className="an-time">{formatAgo(a.hoursAgo)}</div>
        </div>
        {a.pinned ? (
          <span className="an-pinned-badge">
            <Pin size={12} /> Pinned
          </span>
        ) : null}
        <button
          className="icon-btn"
          style={{ width: 30, height: 30 }}
          title={a.pinned ? "Unpin" : "Pin"}
          onClick={() => onTogglePin(a.id)}>
          <Pin size={13} />
        </button>
      </div>

      <h3 className="an-title">{a.title}</h3>
      <p className="an-body">{a.body}</p>

      <div className="an-foot">
        <div className="an-reactions">
          {REACTION_SET.map((e) => {
            const n = a.reactions[e] || 0;
            return (
              <button
                key={e}
                className={`an-react ${n ? "has" : ""}`}
                onClick={() => onReact(a.id, e)}>
                <span style={{ fontSize: 14 }}>{e}</span>
                {n ? <span className="an-react-n">{n}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="an-ack">
          <span className="an-ack-count">
            {a.acked}/{a.total} read
          </span>
          <button
            className={`btn btn-sm ${a.youAcked ? "btn-secondary" : "btn-primary"}`}
            disabled={a.youAcked}
            onClick={() => onAck(a.id)}>
            {a.youAcked ? (
              <>
                <Check size={13} /> Acknowledged
              </>
            ) : (
              "Mark as read"
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

export default function AnnouncementsClient() {
  const [anns, setAnns] = useState<Announcement[]>(INITIAL);
  const [seq, setSeq] = useState(100);
  const [composing, setComposing] = useState(false);

  const items = [...anns].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || a.hoursAgo - b.hoursAgo
  );
  const unread = anns.filter((a) => a.unread).length;
  const pinnedCount = anns.filter((a) => a.pinned).length;

  function publish({
    title,
    body,
    pinned,
    audience,
  }: {
    title: string;
    body: string;
    pinned: boolean;
    audience: string;
  }) {
    setAnns((prev) => [
      {
        id: "AN-" + seq,
        pinned,
        audience,
        author: "Diane Moreau",
        hoursAgo: 0,
        unread: false,
        title,
        body,
        reactions: {},
        acked: 0,
        total: 12,
      },
      ...prev,
    ]);
    setSeq((s) => s + 1);
  }

  const markRead = (id: string) =>
    setAnns((prev) => prev.map((a) => (a.id === id ? { ...a, unread: false } : a)));
  const togglePin = (id: string) =>
    setAnns((prev) => prev.map((a) => (a.id === id ? { ...a, pinned: !a.pinned } : a)));
  const react = (id: string, emoji: string) =>
    setAnns((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, reactions: { ...a.reactions, [emoji]: (a.reactions[emoji] || 0) + 1 } }
          : a
      )
    );
  const ack = (id: string) =>
    setAnns((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, acked: Math.min(a.total, a.acked + 1), youAcked: true, unread: false }
          : a
      )
    );

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
        <button className="btn btn-primary" onClick={() => setComposing(true)}>
          <Plus size={15} /> New announcement
        </button>
      </header>

      <div
        className="astat-grid"
        style={{ marginBottom: 26, gridTemplateColumns: "repeat(3, minmax(0,1fr))" }}>
        <Stat icon={<MessageCircle size={16} />} label="Posts" value={items.length} hint="visible to the team" />
        <Stat icon={<AlertCircle size={16} />} label="Unread" value={unread} hint="new since you last looked" up={unread > 0} />
        <Stat icon={<Sparkles size={16} />} label="Pinned" value={pinnedCount} hint="kept at the top" />
      </div>

      <div className="an-feed">
        {items.map((a) => (
          <AnnouncementCard
            key={a.id}
            a={a}
            onMarkRead={markRead}
            onTogglePin={togglePin}
            onReact={react}
            onAck={ack}
          />
        ))}
      </div>

      {composing ? (
        <ComposeModal onClose={() => setComposing(false)} onPublish={publish} />
      ) : null}
    </div>
  );
}
