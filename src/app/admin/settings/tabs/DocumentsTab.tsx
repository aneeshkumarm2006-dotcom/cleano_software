"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  FileSignature,
  Send,
  CheckCircle2,
  Clock,
  Users,
} from "lucide-react";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import Modal from "@/components/ui/Modal";
import { ConfirmDeleteModal } from "@/components/common/ConfirmDeleteModal";
import PremiumSelect from "@/components/ui/PremiumSelect";
import DatePicker from "@/components/ui/DatePicker";
import { createDocument } from "../../actions/createDocument";
import { assignDocument } from "../../actions/assignDocument";
import { deleteDocument } from "../../actions/deleteDocument";
import { remindDocument } from "../../actions/remindDocument";
import {
  SectionCard,
  Field,
  Feedback,
  Msg,
  themedInputClass,
  themedSelectClass,
} from "./_shared";

type Role = "OWNER" | "ADMIN" | "EMPLOYEE";
type DocStatus = "PENDING" | "SIGNED" | "EXPIRED" | "REVOKED";

export interface DocumentSignatureRecord {
  id: string;
  status: DocStatus;
  signedAt: string | null;
  employee: { id: string; name: string };
}

export interface DocumentRecord {
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  fileUrl: string | null;
  version: string;
  dueDate: string | null;
  createdAt: string;
  signatures: DocumentSignatureRecord[];
}

export interface UserOption {
  id: string;
  name: string;
  role: Role;
}

interface DocumentsTabProps {
  documents: DocumentRecord[];
  users: UserOption[];
}

type AssignMode = "ALL" | "ROLES" | "USERS";

interface DraftDocument {
  title: string;
  description: string;
  contentMode: "TEXT" | "FILE";
  content: string;
  fileUrl: string;
  version: string;
  dueDate: string;
  assignMode: AssignMode;
  assignRoles: Role[];
  assignUserIds: string[];
}

const EMPTY_DRAFT: DraftDocument = {
  title: "",
  description: "",
  contentMode: "TEXT",
  content: "",
  fileUrl: "",
  version: "1.0",
  dueDate: "",
  assignMode: "ALL",
  assignRoles: ["EMPLOYEE"],
  assignUserIds: [],
};

const ROLES: Role[] = ["OWNER", "ADMIN", "EMPLOYEE"];

function formatDate(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function DocumentsTab({ documents, users }: DocumentsTabProps) {
  const [modalOpen, setModalOpen] = useState(false);
  const [assignDocId, setAssignDocId] = useState<string | null>(null);
  const [statusDocId, setStatusDocId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftDocument>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const [assignMode, setAssignMode] = useState<AssignMode>("ALL");
  const [assignRoles, setAssignRoles] = useState<Role[]>(["EMPLOYEE"]);
  const [assignUserIds, setAssignUserIds] = useState<string[]>([]);
  const [assignSaving, setAssignSaving] = useState(false);

  const assignDoc = useMemo(
    () => documents.find((d) => d.id === assignDocId) ?? null,
    [documents, assignDocId]
  );
  const statusDoc = useMemo(
    () => documents.find((d) => d.id === statusDocId) ?? null,
    [documents, statusDocId]
  );

  function openCreate() {
    setDraft(EMPTY_DRAFT);
    setMsg(null);
    setModalOpen(true);
  }

  function openAssign(id: string) {
    setAssignMode("ALL");
    setAssignRoles(["EMPLOYEE"]);
    setAssignUserIds([]);
    setMsg(null);
    setAssignDocId(id);
  }

  function toggleRoleInDraft(role: Role) {
    setDraft((prev) => ({
      ...prev,
      assignRoles: prev.assignRoles.includes(role)
        ? prev.assignRoles.filter((r) => r !== role)
        : [...prev.assignRoles, role],
    }));
  }

  function toggleUserInDraft(id: string) {
    setDraft((prev) => ({
      ...prev,
      assignUserIds: prev.assignUserIds.includes(id)
        ? prev.assignUserIds.filter((u) => u !== id)
        : [...prev.assignUserIds, id],
    }));
  }

  function toggleAssignRole(role: Role) {
    setAssignRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  function toggleAssignUser(id: string) {
    setAssignUserIds((prev) =>
      prev.includes(id) ? prev.filter((u) => u !== id) : [...prev, id]
    );
  }

  async function handleSave() {
    if (!draft.title.trim()) {
      setMsg({ type: "error", text: "Title is required." });
      return;
    }
    if (draft.contentMode === "TEXT" && !draft.content.trim()) {
      setMsg({ type: "error", text: "Document content is required." });
      return;
    }
    if (draft.contentMode === "FILE" && !draft.fileUrl.trim()) {
      setMsg({ type: "error", text: "File URL is required." });
      return;
    }
    if (draft.assignMode === "ROLES" && draft.assignRoles.length === 0) {
      setMsg({ type: "error", text: "Pick at least one role." });
      return;
    }
    if (draft.assignMode === "USERS" && draft.assignUserIds.length === 0) {
      setMsg({ type: "error", text: "Pick at least one user." });
      return;
    }

    setSaving(true);
    setMsg(null);

    const res = await createDocument({
      title: draft.title,
      description: draft.description || null,
      content: draft.contentMode === "TEXT" ? draft.content : null,
      fileUrl: draft.contentMode === "FILE" ? draft.fileUrl : null,
      version: draft.version || "1.0",
      dueDate: draft.dueDate || null,
      assignTo: {
        mode: draft.assignMode,
        roles: draft.assignMode === "ROLES" ? draft.assignRoles : undefined,
        userIds:
          draft.assignMode === "USERS" ? draft.assignUserIds : undefined,
      },
    });

    if (res.success) {
      setMsg({ type: "success", text: "Document created and assigned." });
      setModalOpen(false);
    } else {
      setMsg({ type: "error", text: res.error || "Failed to save." });
    }
    setSaving(false);
  }

  const [deleteId, setDeleteId] = useState<string | null>(null);
  function handleDelete(id: string) { setDeleteId(id); }
  async function runDelete() {
    if (!deleteId) return;
    const id = deleteId;
    setDeleteId(null);
    setMsg(null);
    const res = await deleteDocument(id);
    if (res.success) {
      setMsg({ type: "success", text: "Document deleted." });
    } else {
      setMsg({ type: "error", text: res.error || "Failed to delete." });
    }
  }

  async function handleRemind(id: string) {
    setMsg(null);
    const res = await remindDocument(id);
    if (res.success) {
      setMsg({
        type: "success",
        text: `Reminder created for ${res.reminded} pending signer(s).`,
      });
    } else {
      setMsg({ type: "error", text: res.error || "Failed to remind." });
    }
  }

  async function handleAssign() {
    if (!assignDoc) return;
    if (assignMode === "ROLES" && assignRoles.length === 0) {
      setMsg({ type: "error", text: "Pick at least one role." });
      return;
    }
    if (assignMode === "USERS" && assignUserIds.length === 0) {
      setMsg({ type: "error", text: "Pick at least one user." });
      return;
    }

    setAssignSaving(true);
    setMsg(null);
    const res = await assignDocument({
      documentId: assignDoc.id,
      mode: assignMode,
      roles: assignMode === "ROLES" ? assignRoles : undefined,
      userIds: assignMode === "USERS" ? assignUserIds : undefined,
    });
    if (res.success) {
      setMsg({
        type: "success",
        text: `Assigned to ${res.assignedCount} user(s).`,
      });
      setAssignDocId(null);
    } else {
      setMsg({ type: "error", text: res.error || "Failed to assign." });
    }
    setAssignSaving(false);
  }

  return (
    <SectionCard
      title="Documents"
      description="Upload or write documents and assign them for e-signature."
      icon={FileSignature}
      actions={
        <Button
          type="button"
          variant="action"
          border={false}
          size="sm"
          onClick={openCreate}
          className="rounded-xl">
          <Plus className="w-4 h-4 mr-1" /> New Document
        </Button>
      }>
      {documents.length === 0 ? (
        <p className="text-sm text-[#008C9C]/60">No documents yet.</p>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => {
            const total = doc.signatures.length;
            const signed = doc.signatures.filter(
              (s) => s.status === "SIGNED"
            ).length;
            const pending = total - signed;
            return (
              <div
                key={doc.id}
                className="flex items-start justify-between gap-3 p-4 border border-[#008C9C]/10 rounded-xl bg-white hover:bg-[#008C9C]/3 transition-colors">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-[400] text-[#008C9C]">
                      {doc.title}
                    </h3>
                    <span className="text-xs bg-[#008C9C]/10 text-[#008C9C] px-2 py-0.5 rounded-full">
                      v{doc.version}
                    </span>
                    {doc.fileUrl && (
                      <span className="text-xs bg-[#3E7596]/20 text-[#008C9C] px-2 py-0.5 rounded-full">
                        File
                      </span>
                    )}
                  </div>
                  {doc.description && (
                    <p className="text-xs text-[#008C9C]/60 mt-1">
                      {doc.description}
                    </p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs text-[#008C9C]/60 flex-wrap">
                    {doc.dueDate && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Due {formatDate(doc.dueDate)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setStatusDocId(doc.id)}
                      className="flex items-center gap-1 text-[#008C9C] hover:underline">
                      <CheckCircle2 className="w-3 h-3" />
                      {signed}/{total} signed
                    </button>
                    {pending > 0 && (
                      <span className="text-yellow-700">
                        {pending} pending
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-1">
                  <IconButton
                    icon={Users}
                    variant="ghost"
                    size="sm"
                    onClick={() => openAssign(doc.id)}
                    title="Assign to more users"
                  />
                  <IconButton
                    icon={Send}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemind(doc.id)}
                    title="Send reminders"
                    disabled={pending === 0}
                  />
                  <IconButton
                    icon={Trash2}
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(doc.id)}
                    className="text-red-500"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {msg && (
        <div className="mt-3">
          <Feedback msg={msg} />
        </div>
      )}

      {/* Create Document Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New Document">
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <Field label="Title">
            <Input
              variant="form"
              value={draft.title}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, title: e.target.value }))
              }
              placeholder="e.g. Code of Conduct"
            />
          </Field>

          <Field label="Description">
            <Input
              variant="form"
              value={draft.description}
              onChange={(e) =>
                setDraft((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              placeholder="Optional summary"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Version">
              <input
                type="text"
                value={draft.version}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, version: e.target.value }))
                }
                placeholder="1.0"
                className={themedInputClass}
              />
            </Field>
            <Field label="Due Date" hint="Optional.">
              <DatePicker
                value={draft.dueDate}
                onChange={(v) =>
                  setDraft((prev) => ({ ...prev, dueDate: v }))
                }
                size="sm"
              />
            </Field>
          </div>

          <Field label="Content Type">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => ({ ...prev, contentMode: "TEXT" }))
                }
                className={`px-4 py-2 rounded-xl text-sm ${
                  draft.contentMode === "TEXT"
                    ? "bg-[#008C9C]/90 text-white"
                    : "bg-[#008C9C]/5 text-[#008C9C] hover:bg-[#008C9C]/10"
                }`}>
                Text
              </button>
              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => ({ ...prev, contentMode: "FILE" }))
                }
                className={`px-4 py-2 rounded-xl text-sm ${
                  draft.contentMode === "FILE"
                    ? "bg-[#008C9C]/90 text-white"
                    : "bg-[#008C9C]/5 text-[#008C9C] hover:bg-[#008C9C]/10"
                }`}>
                File URL (PDF)
              </button>
            </div>
          </Field>

          {draft.contentMode === "TEXT" ? (
            <Field label="Document Text">
              <textarea
                rows={8}
                value={draft.content}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, content: e.target.value }))
                }
                placeholder="Paste or write document text here..."
                className={`${themedInputClass} resize-y`}
              />
            </Field>
          ) : (
            <Field
              label="File URL"
              hint="Direct link to PDF or document.">
              <input
                type="url"
                value={draft.fileUrl}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, fileUrl: e.target.value }))
                }
                placeholder="https://..."
                className={themedInputClass}
              />
            </Field>
          )}

          <Field label="Assign to">
            <PremiumSelect
              value={draft.assignMode}
              onChange={(v) =>
                setDraft((prev) => ({
                  ...prev,
                  assignMode: v as AssignMode,
                }))
              }
              options={[
                { value: "ALL", label: "All employees" },
                { value: "ROLES", label: "Specific roles" },
                { value: "USERS", label: "Specific users" },
              ]}
              size="sm"
            />
          </Field>

          {draft.assignMode === "ROLES" && (
            <div className="flex flex-wrap gap-2">
              {ROLES.map((role) => (
                <label
                  key={role}
                  className="flex items-center gap-2 text-sm text-[#008C9C] select-none">
                  <input
                    type="checkbox"
                    checked={draft.assignRoles.includes(role)}
                    onChange={() => toggleRoleInDraft(role)}
                    className="accent-[#008C9C]"
                  />
                  {role}
                </label>
              ))}
            </div>
          )}

          {draft.assignMode === "USERS" && (
            <div className="max-h-48 overflow-y-auto space-y-1 p-2 rounded-xl bg-[#008C9C]/5">
              {users.length === 0 ? (
                <p className="text-xs text-[#008C9C]/60">No users found.</p>
              ) : (
                users.map((u) => (
                  <label
                    key={u.id}
                    className="flex items-center gap-2 text-sm text-[#008C9C] select-none px-2 py-1 rounded hover:bg-white/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.assignUserIds.includes(u.id)}
                      onChange={() => toggleUserInDraft(u.id)}
                      className="accent-[#008C9C]"
                    />
                    <span className="flex-1">{u.name}</span>
                    <span className="text-xs text-[#008C9C]/50">{u.role}</span>
                  </label>
                ))
              )}
            </div>
          )}

          {msg && <Feedback msg={msg} />}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              border={false}
              onClick={() => setModalOpen(false)}
              className="rounded-xl">
              Cancel
            </Button>
            <Button
              type="button"
              variant="action"
              border={false}
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl px-6">
              {saving ? "Saving..." : "Create & Assign"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Assign Modal */}
      <Modal
        isOpen={!!assignDoc}
        onClose={() => setAssignDocId(null)}
        title={assignDoc ? `Assign — ${assignDoc.title}` : "Assign"}>
        {assignDoc && (
          <div className="space-y-4">
            <Field label="Assign to">
              <PremiumSelect
                value={assignMode}
                onChange={(v) => setAssignMode(v as AssignMode)}
                options={[
                  { value: "ALL", label: "All employees" },
                  { value: "ROLES", label: "Specific roles" },
                  { value: "USERS", label: "Specific users" },
                ]}
                size="sm"
              />
            </Field>

            {assignMode === "ROLES" && (
              <div className="flex flex-wrap gap-2">
                {ROLES.map((role) => (
                  <label
                    key={role}
                    className="flex items-center gap-2 text-sm text-[#008C9C] select-none">
                    <input
                      type="checkbox"
                      checked={assignRoles.includes(role)}
                      onChange={() => toggleAssignRole(role)}
                      className="accent-[#008C9C]"
                    />
                    {role}
                  </label>
                ))}
              </div>
            )}

            {assignMode === "USERS" && (
              <div className="max-h-48 overflow-y-auto space-y-1 p-2 rounded-xl bg-[#008C9C]/5">
                {users.map((u) => (
                  <label
                    key={u.id}
                    className="flex items-center gap-2 text-sm text-[#008C9C] select-none px-2 py-1 rounded hover:bg-white/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={assignUserIds.includes(u.id)}
                      onChange={() => toggleAssignUser(u.id)}
                      className="accent-[#008C9C]"
                    />
                    <span className="flex-1">{u.name}</span>
                    <span className="text-xs text-[#008C9C]/50">
                      {u.role}
                    </span>
                  </label>
                ))}
              </div>
            )}

            <p className="text-xs text-[#008C9C]/60">
              Existing signers will not be re-assigned. Only new users will
              receive a pending signature.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                border={false}
                onClick={() => setAssignDocId(null)}
                className="rounded-xl">
                Cancel
              </Button>
              <Button
                type="button"
                variant="action"
                border={false}
                onClick={handleAssign}
                disabled={assignSaving}
                className="rounded-xl px-6">
                {assignSaving ? "Assigning..." : "Assign"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Status Modal */}
      <Modal
        isOpen={!!statusDoc}
        onClose={() => setStatusDocId(null)}
        title={statusDoc ? `Signature Status — ${statusDoc.title}` : "Status"}>
        {statusDoc && (
          <div className="space-y-3">
            {statusDoc.signatures.length === 0 ? (
              <p className="text-sm text-[#008C9C]/60">
                No employees assigned yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50/50 border-b border-gray-100">
                      <th className="px-4 py-2 text-left text-xs font-[400] text-gray-500 uppercase tracking-wider">
                        Employee
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-[400] text-gray-500 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-[400] text-gray-500 uppercase tracking-wider">
                        Signed At
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {statusDoc.signatures.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2 text-[#008C9C]">
                          {s.employee.name}
                        </td>
                        <td className="px-4 py-2 text-[#008C9C]/80">
                          {s.status === "SIGNED" ? (
                            <span className="text-green-700">Signed</span>
                          ) : s.status === "PENDING" ? (
                            <span className="text-yellow-700">Pending</span>
                          ) : (
                            s.status.toLowerCase()
                          )}
                        </td>
                        <td className="px-4 py-2 text-[#008C9C]/80">
                          {formatDate(s.signedAt) ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDeleteModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={runDelete}
        fileName="this document"
        title="Delete document?"
        message="All signature records for this document will also be removed."
      />
    </SectionCard>
  );
}
