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
  Eye,
  GraduationCap,
  Users,
} from "lucide-react";
import Link from "next/link";
import { initials } from "@/lib/avatar";

// The employee preview renders REAL training modules and REAL documents. It
// previously used hardcoded sample videos and PDFs, so an admin "previewing"
// the employee experience was shown content that does not exist (item 22).

// Real activity rows (item 20) — recorded by the document open/download/sign
// flows and passed in from the server page. No sample data.
export interface AccessLogEntry {
  id: string;
  who: string;
  docTitle: string;
  action: string; // OPEN | VIEW | DOWNLOAD | COMPLETE
  at: string; // ISO timestamp
}

const ACTION_TINT: Record<string, { bg: string; fg: string }> = {
  OPEN: { bg: "var(--blue-100)", fg: "var(--blue-800)" },
  VIEW: { bg: "var(--blue-100)", fg: "var(--blue-800)" },
  DOWNLOAD: { bg: "var(--amber-50)", fg: "var(--amber-800)" },
  COMPLETE: { bg: "var(--emerald-50)", fg: "var(--emerald-600)" },
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

export interface TrainingModuleRow {
  id: string;
  title: string;
  description: string | null;
  duration: number | null;
  isRequired: boolean;
  isActive: boolean;
  hasVideo: boolean;
  quizCount: number;
}

export interface TrainingProgressRow {
  employeeId: string;
  employeeName: string;
  completed: number;
  requiredTotal: number;
  avgQuizScore: number | null;
  lastActivityAt: string | null;
}

export interface TrainingDocumentRow {
  id: string;
  title: string;
  description: string | null;
  version: string;
  hasFile: boolean;
}

export default function TrainingDocsClient({
  modules = [],
  progress = [],
  documents = [],
  accessLog = [],
}: {
  modules?: TrainingModuleRow[];
  progress?: TrainingProgressRow[];
  documents?: TrainingDocumentRow[];
  accessLog?: AccessLogEntry[];
}) {
  // What a cleaner actually has to get through.
  const VIDEOS = modules
    .filter((m) => m.isActive && m.isRequired)
    .map((m) => ({
      id: m.id,
      title: m.title,
      duration: m.duration ? `${m.duration} min` : "Video",
    }));
  const DOCS = documents.map((d) => ({
    id: d.id,
    title: d.title,
    kind: d.hasFile ? "PDF" : "Doc",
    version: d.version,
  }));
  const [watched, setWatched] = useState<Record<string, boolean>>({});
  const [passed, setPassed] = useState(false);
  // Item 22: admins land on the MANAGEMENT view. The employee onboarding flow
  // is a deliberate preview, not the default — an admin must never be shown
  // locked training steps as though they were the employee completing them.
  const [previewAsEmployee, setPreviewAsEmployee] = useState(false);

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
      // No invented score: this is a preview simulation, and a fabricated
      // percentage is exactly the kind of fake data the client flagged.
      sub: unlocked ? "Passed" : videosDone ? "Ready to take" : "Locked",
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
          className={`td-viewtoggle ${previewAsEmployee ? "on" : ""}`}
          onClick={() => setPreviewAsEmployee((v) => !v)}>
          {previewAsEmployee ? "Back to admin view" : "View as employee"}
        </button>
      </header>

      {previewAsEmployee ? (
        <>
          {/* Banner so the admin is never confused about whose screen this is. */}
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px", borderRadius: 12, marginBottom: 18,
              background: "var(--amber-50)", border: "1px solid var(--amber-200, #fde68a)",
              color: "var(--amber-800, #92400e)", fontSize: 13,
            }}>
            <Eye size={16} />
            <span>
              <strong>Preview — employee view.</strong> This is what a cleaner
              sees. Nothing here is recorded against your account.
            </span>
          </div>

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
                  ? "Quiz passed"
                  : quizActuallyAvailable
                  ? "Quiz ready"
                  : "Quiz locked"}
              </div>
              <div className="td-quiz-sub">
                {unlocked
                  ? "Documents are now unlocked below."
                  : quizActuallyAvailable
                  ? "Knowledge quiz"
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
                      {d.kind} · v{d.version}
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
                      {d.kind} · version {d.version}
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

        </>
      ) : (
        <AdminManagementView modules={modules} progress={progress} />
      )}

      {/* Document access log — admin only, hidden while previewing. */}
      {!previewAsEmployee ? (
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
          {accessLog.length === 0 ? (
            <div
              style={{
                padding: "18px 16px",
                borderRadius: 12,
                border: "1px dashed var(--primary-20)",
                color: "var(--primary-60)",
                fontSize: 13.5,
              }}>
              No document activity yet. Opens, downloads, and completed
              signatures will appear here as staff work through their documents.
            </div>
          ) : (
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
                    {accessLog.map((l) => {
                      const cfg = ACTION_TINT[l.action] ?? ACTION_TINT.OPEN;
                      const mins = Math.max(
                        0,
                        Math.round((Date.now() - new Date(l.at).getTime()) / 60000)
                      );
                      return (
                        <tr key={l.id} style={{ cursor: "default" }}>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <Avatar name={l.who} size={30} />
                              <span style={{ fontWeight: 600, color: "var(--ink)" }}>
                                {l.who}
                              </span>
                            </div>
                          </td>
                          <td style={{ color: "var(--ink-soft)" }}>{l.docTitle}</td>
                          <td>
                            <span className="pill" style={{ background: cfg.bg, color: cfg.fg }}>
                              {l.action.toLowerCase()}
                            </span>
                          </td>
                          <td style={{ color: "var(--primary-60)", fontSize: 12.5 }}>
                            {formatAgo(mins)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The admin-facing half of the page (item 22): manage training CONTENT and see
 * employee PROGRESS. Built entirely from real TrainingModule / TrainingProgress
 * data — the page previously rendered hardcoded sample videos, sample PDFs and
 * a fabricated "Passed · 92%".
 */
function AdminManagementView({
  modules,
  progress,
}: {
  modules: TrainingModuleRow[];
  progress: TrainingProgressRow[];
}) {
  const activeModules = modules.filter((m) => m.isActive);
  const requiredCount = activeModules.filter((m) => m.isRequired).length;
  const fullyTrained = progress.filter(
    (p) => p.requiredTotal > 0 && p.completed >= p.requiredTotal
  ).length;

  return (
    <div className="stack-8" style={{ display: "grid", gap: 26 }}>
      <div className="astat-grid">
        <div className="astat">
          <div className="astat-head">
            <span className="astat-label">Training modules</span>
            <div className="astat-icon"><GraduationCap size={15} /></div>
          </div>
          <div className="astat-value">{activeModules.length}</div>
          <div className="astat-delta">
            {requiredCount} required · {modules.length - activeModules.length} inactive
          </div>
        </div>
        <div className="astat">
          <div className="astat-head">
            <span className="astat-label">Fully trained</span>
            <div className="astat-icon"><Users size={15} /></div>
          </div>
          <div className="astat-value">
            {fullyTrained}/{progress.length}
          </div>
          <div className="astat-delta">
            {requiredCount === 0
              ? "No required modules set"
              : "Completed every required module"}
          </div>
        </div>
      </div>

      {/* Training content */}
      <div>
        <div className="td-seclabel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Training content</span>
          <Link href="/admin/settings?tab=training" className="btn btn-secondary btn-sm">
            Manage modules
          </Link>
        </div>
        {activeModules.length === 0 ? (
          <div
            style={{
              padding: "18px 16px", borderRadius: 12,
              border: "1px dashed var(--primary-20)",
              color: "var(--primary-60)", fontSize: 13.5,
            }}>
            No training modules yet. Add them in Settings → Training and they will
            appear here and in every employee&apos;s onboarding.
          </div>
        ) : (
          <div className="atable-wrap">
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th>Module</th>
                    <th>Length</th>
                    <th>Quiz</th>
                    <th>Required</th>
                  </tr>
                </thead>
                <tbody>
                  {activeModules.map((m) => (
                    <tr key={m.id} style={{ cursor: "default" }}>
                      <td>
                        <div style={{ fontWeight: 600, color: "var(--ink)" }}>{m.title}</div>
                        {m.description && (
                          <div style={{ fontSize: 12.5, color: "var(--primary-60)" }}>
                            {m.description}
                          </div>
                        )}
                      </td>
                      <td style={{ color: "var(--ink-soft)" }}>
                        {m.duration ? `${m.duration} min` : m.hasVideo ? "Video" : "—"}
                      </td>
                      <td style={{ color: "var(--ink-soft)" }}>
                        {m.quizCount > 0 ? `${m.quizCount} question${m.quizCount === 1 ? "" : "s"}` : "None"}
                      </td>
                      <td>
                        <span
                          className="pill"
                          style={
                            m.isRequired
                              ? { background: "var(--amber-50)", color: "var(--amber-800, #92400e)" }
                              : { background: "var(--primary-5)", color: "var(--primary-60)" }
                          }>
                          {m.isRequired ? "Required" : "Optional"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Employee progress */}
      <div>
        <div className="td-seclabel">Employee progress</div>
        {progress.length === 0 ? (
          <div
            style={{
              padding: "18px 16px", borderRadius: 12,
              border: "1px dashed var(--primary-20)",
              color: "var(--primary-60)", fontSize: 13.5,
            }}>
            No active employees to track yet.
          </div>
        ) : (
          <div className="atable-wrap">
            <div className="atable-scroll">
              <table className="atable">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Required modules</th>
                    <th>Avg quiz score</th>
                    <th>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {progress.map((p) => {
                    const pct =
                      p.requiredTotal > 0
                        ? Math.round((p.completed / p.requiredTotal) * 100)
                        : 0;
                    const complete = p.requiredTotal > 0 && p.completed >= p.requiredTotal;
                    return (
                      <tr key={p.employeeId} style={{ cursor: "default" }}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <Avatar name={p.employeeName} size={30} />
                            <span style={{ fontWeight: 600, color: "var(--ink)" }}>
                              {p.employeeName}
                            </span>
                          </div>
                        </td>
                        <td style={{ minWidth: 180 }}>
                          <div
                            style={{
                              display: "flex", alignItems: "center", gap: 8,
                              color: complete ? "var(--emerald-600)" : "var(--ink-soft)",
                              fontVariantNumeric: "tabular-nums",
                            }}>
                            <span>
                              {p.completed}/{p.requiredTotal}
                            </span>
                            <div className="score-bar" style={{ flex: 1, height: 7 }}>
                              <span className="score-fill" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        </td>
                        <td style={{ color: "var(--ink-soft)", fontVariantNumeric: "tabular-nums" }}>
                          {/* Never render "0%" for someone who simply hasn't
                              taken a quiz yet. */}
                          {p.avgQuizScore === null ? "—" : `${p.avgQuizScore}%`}
                        </td>
                        <td style={{ color: "var(--primary-60)", fontSize: 12.5 }}>
                          {p.lastActivityAt
                            ? formatAgo(
                                Math.max(
                                  0,
                                  Math.round(
                                    (Date.now() - new Date(p.lastActivityAt).getTime()) / 60000
                                  )
                                )
                              )
                            : "Not started"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
