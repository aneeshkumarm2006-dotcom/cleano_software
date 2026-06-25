"use client";

import { useState } from "react";
import {
  Check,
  CheckCircle2,
  Star,
  FileText,
  Download,
  Lock,
  Play,
} from "lucide-react";
import { initials } from "@/lib/avatar";

interface Video {
  id: string;
  title: string;
  duration: string;
}
interface Doc {
  id: string;
  title: string;
  kind: string;
  pages: number;
}
interface LogEntry {
  who: string;
  docId: string;
  action: "unlocked" | "viewed" | "downloaded";
  minsAgo: number;
}

const VIDEOS: Video[] = [
  { id: "V-1", title: "Welcome & professional standards", duration: "8:24" },
  { id: "V-2", title: "Equipment & approved products", duration: "12:10" },
  { id: "V-3", title: "Health, safety & WHMIS basics", duration: "9:46" },
];

const DOCS: Doc[] = [
  { id: "D-1", title: "Employee handbook", kind: "PDF", pages: 24 },
  { id: "D-2", title: "Service checklists (all clean types)", kind: "PDF", pages: 11 },
  { id: "D-3", title: "Safety data sheets (SDS) binder", kind: "PDF", pages: 38 },
  { id: "D-4", title: "Code of conduct & confidentiality", kind: "PDF", pages: 6 },
];

const LOG: LogEntry[] = [
  { who: "Aïcha Diallo", docId: "D-1", action: "unlocked", minsAgo: 40 },
  { who: "Aïcha Diallo", docId: "D-1", action: "viewed", minsAgo: 38 },
  { who: "Diego Ramírez", docId: "D-2", action: "viewed", minsAgo: 190 },
  { who: "Camille Bouchard", docId: "D-3", action: "downloaded", minsAgo: 1440 },
  { who: "Sophie Lavoie", docId: "D-1", action: "unlocked", minsAgo: 2880 },
];

const ACTION_TINT: Record<LogEntry["action"], { bg: string; fg: string }> = {
  unlocked: { bg: "var(--emerald-50)", fg: "var(--emerald-600)" },
  viewed: { bg: "var(--blue-100)", fg: "var(--blue-800)" },
  downloaded: { bg: "var(--amber-50)", fg: "var(--amber-800)" },
};

function formatAgo(mins: number) {
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) {
    const h = Math.round(mins / 60);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.round(mins / 1440);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function Avatar({ name, size }: { name: string; size: number }) {
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        border: 0,
        background: "var(--primary)",
      }}>
      {initials(name)}
    </span>
  );
}

export default function TrainingDocsClient() {
  const [watched, setWatched] = useState<Record<string, boolean>>({});
  const [passed, setPassed] = useState(false);
  const [admin, setAdmin] = useState(false);

  const watchedCount = VIDEOS.filter((v) => watched[v.id]).length;
  const videosDone = watchedCount === VIDEOS.length;
  const quizActuallyAvailable = videosDone && !passed;
  const unlocked = passed;

  const steps = [
    {
      label: "Watch videos",
      sub: `${watchedCount} / ${VIDEOS.length} complete`,
      done: videosDone,
      active: !videosDone,
    },
    {
      label: "Pass the quiz",
      sub: unlocked ? "Passed · 92%" : videosDone ? "Ready to take" : "Locked",
      done: unlocked,
      active: videosDone && !unlocked,
    },
    {
      label: "Documents unlocked",
      sub: unlocked ? `${DOCS.length} documents available` : "Locked",
      done: unlocked,
      active: false,
    },
  ];

  return (
    <div className="admin-font">
      <header
        className="row-between"
        style={{ marginBottom: 24, alignItems: "flex-end", flexWrap: "wrap", gap: 16 }}>
        <div className="stack-8">
          <p className="eyebrow">Onboarding · Compliance</p>
          <h1 className="display" style={{ fontSize: "clamp(30px, 3.6vw, 42px)" }}>
            Training &amp; documents
          </h1>
        </div>
        <button
          className={`td-viewtoggle ${admin ? "on" : ""}`}
          onClick={() => setAdmin((a) => !a)}>
          {admin ? "Viewing as admin" : "View as admin"}
        </button>
      </header>

      {/* Unlock-gate stepper */}
      <div className="td-stepper">
        {steps.map((s, i) => (
          <div key={i} style={{ display: "contents" }}>
            <div className={`td-step ${s.done ? "done" : s.active ? "active" : ""}`}>
              <span className="td-step-dot">{s.done ? <Check size={15} /> : i + 1}</span>
              <div>
                <div className="td-step-label">{s.label}</div>
                <div className="td-step-sub">{s.sub}</div>
              </div>
            </div>
            {i < steps.length - 1 ? (
              <span className={`td-step-bar ${steps[i].done ? "done" : ""}`} />
            ) : null}
          </div>
        ))}
      </div>

      <div className="td-grid">
        {/* Left: videos + quiz */}
        <div className="td-col">
          <div className="td-seclabel">Required videos</div>
          <div className="td-cards">
            {VIDEOS.map((v) => {
              const done = !!watched[v.id];
              return (
                <div className={`td-video ${done ? "done" : ""}`} key={v.id}>
                  <span className="td-video-thumb">
                    {done ? <Check size={16} /> : <Play size={14} fill="currentColor" />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="td-video-title">{v.title}</div>
                    <div className="td-video-meta">
                      {v.duration} · {done ? "Watched" : "Not watched"}
                    </div>
                  </div>
                  {done ? (
                    <span className="td-check">
                      <CheckCircle2 size={18} />
                    </span>
                  ) : (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setWatched((w) => ({ ...w, [v.id]: true }))}>
                      Mark watched
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="td-seclabel" style={{ marginTop: 22 }}>
            Knowledge quiz
          </div>
          <div
            className={`td-quiz ${
              unlocked ? "passed" : quizActuallyAvailable ? "ready" : "locked"
            }`}>
            <span className="td-quiz-icon">
              {unlocked ? (
                <CheckCircle2 size={20} />
              ) : quizActuallyAvailable ? (
                <Star size={20} />
              ) : (
                <Lock size={18} />
              )}
            </span>
            <div style={{ flex: 1 }}>
              <div className="td-quiz-title">
                {unlocked
                  ? "Quiz passed — 92%"
                  : quizActuallyAvailable
                  ? "Quiz ready"
                  : "Quiz locked"}
              </div>
              <div className="td-quiz-sub">
                {unlocked
                  ? "Documents are now unlocked below."
                  : quizActuallyAvailable
                  ? "10 questions · 80% to pass"
                  : "Watch all required videos to unlock the quiz."}
              </div>
            </div>
            {quizActuallyAvailable ? (
              <button className="btn btn-primary btn-sm" onClick={() => setPassed(true)}>
                Start quiz
              </button>
            ) : null}
          </div>
        </div>

        {/* Right: documents (locked until gated) */}
        <div className="td-col">
          <div className="td-seclabel">
            Documents
            <span className={`td-lockpill ${unlocked ? "open" : ""}`}>
              {unlocked ? (
                <>
                  <Check size={11} /> Unlocked
                </>
              ) : (
                <>
                  <Lock size={11} /> Locked
                </>
              )}
            </span>
          </div>

          {!unlocked ? (
            <div className="td-lockedcard">
              <span className="td-lockedcard-icon">
                <Lock size={26} />
              </span>
              <h3 className="td-lockedcard-title">{DOCS.length} documents are locked</h3>
              <p className="td-lockedcard-sub">
                Complete the required videos and pass the quiz to unlock the document
                library. Content is withheld until the gate is cleared.
              </p>
              <div className="td-lockedcard-prog">
                <div className="td-lockedcard-progrow">
                  <span>Videos watched</span>
                  <strong>
                    {watchedCount}/{VIDEOS.length}
                  </strong>
                </div>
                <div className="score-bar" style={{ maxWidth: "100%", height: 7 }}>
                  <span
                    className="score-fill"
                    style={{ width: `${(watchedCount / VIDEOS.length) * 100}%` }}
                  />
                </div>
                <div className="td-lockedcard-progrow" style={{ marginTop: 12 }}>
                  <span>Quiz</span>
                  <strong
                    style={{
                      color: quizActuallyAvailable
                        ? "var(--amber-700)"
                        : "var(--primary-50)",
                    }}>
                    {quizActuallyAvailable ? "Ready" : "Locked"}
                  </strong>
                </div>
              </div>
              {/* Locked document names are shown, but never their content */}
              <div className="td-lockedlist">
                {DOCS.map((d) => (
                  <div className="td-lockedlist-item" key={d.id}>
                    <Lock size={13} />
                    <span>{d.title}</span>
                    <span className="td-lockedlist-meta">
                      {d.kind} · {d.pages}p
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="td-cards">
              {DOCS.map((d) => (
                <div className="td-doc" key={d.id}>
                  <span className="td-doc-icon">
                    <FileText size={17} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="td-doc-title">{d.title}</div>
                    <div className="td-doc-meta">
                      {d.kind} · {d.pages} pages
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-secondary btn-sm">View</button>
                    <button
                      className="icon-btn"
                      style={{ width: 32, height: 32 }}
                      title="Download">
                      <Download size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Admin access log */}
      {admin ? (
        <div style={{ marginTop: 26 }}>
          <div className="td-seclabel">
            Document access log{" "}
            <span
              style={{
                color: "var(--primary-50)",
                fontWeight: 400,
                textTransform: "none",
                letterSpacing: 0,
              }}>
              · admin only
            </span>
          </div>
          <div className="atable-wrap">
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Document</th>
                    <th>Action</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {LOG.map((l, i) => {
                    const doc = DOCS.find((d) => d.id === l.docId);
                    const cfg = ACTION_TINT[l.action];
                    return (
                      <tr key={i} style={{ cursor: "default" }}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <Avatar name={l.who} size={30} />
                            <span style={{ fontWeight: 600, color: "var(--ink)" }}>
                              {l.who}
                            </span>
                          </div>
                        </td>
                        <td style={{ color: "var(--ink-soft)" }}>
                          {doc ? doc.title : l.docId}
                        </td>
                        <td>
                          <span className="pill" style={{ background: cfg.bg, color: cfg.fg }}>
                            {l.action}
                          </span>
                        </td>
                        <td style={{ color: "var(--primary-60)", fontSize: 12.5 }}>
                          {formatAgo(l.minsAgo)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
