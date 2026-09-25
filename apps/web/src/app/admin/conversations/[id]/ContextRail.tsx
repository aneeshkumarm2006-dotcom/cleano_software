"use client";

// Who you are actually talking to.
//
// The thread view showed the message and nothing else — not whether this
// address belongs to a client, what they have booked, or what it is worth. So
// deciding how to answer meant leaving the page to find out.
//
// Closable, because on a narrow screen or a long thread the conversation
// should be able to take the whole width.

import { useState } from "react";
import Link from "next/link";
import { X, PanelRightOpen } from "lucide-react";

export interface ContextData {
  address: string;
  channel: string;
  subject: string | null;
  clientId: string | null;
  clientName: string | null;
  clientPhone: string | null;
  startedAt: string;
  messageCount: number;
  assistantCount: number;
  jobCount: number;
  lifetimeValue: number;
  /** This workspace's rates, so a quote in the thread can be checked. */
  gstRate: number;
  qstRate: number;
}

const money = (n: number) =>
  n.toLocaleString("en-CA", { style: "currency", currency: "USD" });

const when = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default function ContextRail({ data }: { data: ContextData }) {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button
        type="button"
        className="cv-ctx-reopen"
        onClick={() => setOpen(true)}
        aria-expanded="false">
        <PanelRightOpen size={14} aria-hidden="true" /> Lead details
      </button>
    );
  }

  const initials = (data.clientName ?? data.address)
    .replace(/@.*/, "")
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside className="cv-ctx" aria-label="Lead details">
      <div className="cv-ctx-top">
        <span className="cv-ctx-h">Lead details</span>
        <button
          type="button"
          className="cv-ctx-close"
          onClick={() => setOpen(false)}
          aria-label="Hide lead details"
          aria-expanded="true">
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="cv-ctx-sec">
        <div className="cv-who">
          <span className="cv-avatar" aria-hidden="true">{initials}</span>
          <div style={{ minWidth: 0 }}>
            <div className="cv-who-nm">
              {data.clientName ?? "Not a client yet"}
            </div>
            <div className="cv-who-sub">{data.address}</div>
          </div>
        </div>
      </div>

      {/* The one thing that changes how you answer. */}
      {!data.clientId && (
        <div className="cv-ctx-sec">
          <p className="cv-ctx-banner">
            <strong>This address matches nobody on file.</strong> Booking a job
            or quoting from here creates a new client record.
          </p>
        </div>
      )}

      <div className="cv-ctx-sec">
        <div className="cv-ctx-h">This conversation</div>
        <dl className="cv-kv">
          <div><dt>Channel</dt><dd>{data.channel === "SMS" ? "Text" : "Email"}</dd></div>
          {data.subject && <div><dt>Subject</dt><dd>{data.subject}</dd></div>}
          <div><dt>First heard from</dt><dd>{when.format(new Date(data.startedAt))}</dd></div>
          <div><dt>Messages</dt><dd>{data.messageCount}</dd></div>
          <div><dt>Assistant replies</dt><dd>{data.assistantCount}</dd></div>
        </dl>
      </div>

      {data.clientId && (
        <div className="cv-ctx-sec">
          <div className="cv-ctx-h">With you so far</div>
          <dl className="cv-kv">
            <div><dt>Bookings</dt><dd>{data.jobCount}</dd></div>
            <div><dt>Value</dt><dd>{money(data.lifetimeValue)}</dd></div>
            {data.clientPhone && <div><dt>Phone</dt><dd>{data.clientPhone}</dd></div>}
          </dl>
        </div>
      )}

      {/* Whoever is answering may be quoting. The thread cannot tell them which
          taxes this workspace charges, and assuming Quebec is the exact bug
          that had Calgary billing QST. */}
      <div className="cv-ctx-sec">
        <div className="cv-ctx-h">Tax on a quote here</div>
        <dl className="cv-kv">
          <div><dt>GST</dt><dd>{data.gstRate}%</dd></div>
          <div>
            <dt>Provincial</dt>
            <dd>{data.qstRate > 0 ? `${data.qstRate}%` : "None"}</dd>
          </div>
        </dl>
      </div>

      <div className="cv-ctx-sec">
        <div className="cv-ctx-h">What you can do</div>
        <div className="cv-acts">
          <Link className="cv-act" href="/admin/jobs/new">Book the job</Link>
          <Link className="cv-act" href="/admin/quotes">Open quotes</Link>
          {data.clientId && (
            <Link className="cv-act" href={`/admin/clients/${data.clientId}`}>
              Open this client
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}
