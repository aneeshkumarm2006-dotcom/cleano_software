"use client";

import { useState, useTransition } from "react";

import { setStaffRole, type ActionResult } from "@/lib/console/actions";

/**
 * One row of the staff table, with its role control.
 *
 * The control is a select rather than a set of buttons because the choice is
 * one-of-four including "none", and a dropdown makes "remove access" sit in the
 * same place as everything else instead of hiding as a separate destructive
 * button someone clicks by reflex.
 */
export default function StaffRow({
  id,
  name,
  email,
  role,
  lastActive,
  isSelf,
  canEdit,
}: {
  id: string;
  name: string;
  email: string;
  role: "SUPPORT" | "ADMIN" | "OWNER";
  lastActive: string;
  isSelf: boolean;
  canEdit: boolean;
}) {
  const [value, setValue] = useState<string>(role);
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();

  const tone = role === "OWNER" ? "ok" : "plain";

  return (
    <tr>
      <td>
        <div className="org">
          <b>{name}</b>
          <span className="slug">{email}</span>
        </div>
      </td>
      <td>
        <span className={`pill ${tone}`}>
          {role.charAt(0) + role.slice(1).toLowerCase()}
          {isSelf && " · you"}
        </span>
      </td>
      <td className="muted">
        {role === "SUPPORT"
          ? "Read only"
          : role === "ADMIN"
            ? "Plans, trials, suspend"
            : "Everything, incl. staff"}
      </td>
      <td className="num muted">{lastActive}</td>
      <td>
        {!canEdit || isSelf ? (
          <span className="muted">{isSelf ? "Ask another owner" : "Owner only"}</span>
        ) : (
          <div className="formrow" style={{ gap: 6 }}>
            <select
              aria-label={`Platform role for ${name}`}
              value={value}
              disabled={busy}
              style={{ width: 130 }}
              onChange={(e) => setValue(e.target.value)}
            >
              <option value="SUPPORT">Support</option>
              <option value="ADMIN">Admin</option>
              <option value="OWNER">Owner</option>
              <option value="NONE">No access</option>
            </select>
            <button
              type="button"
              className="btn sm"
              disabled={busy || value === role}
              onClick={() =>
                start(async () => {
                  const next = value === "NONE" ? null : (value as "SUPPORT" | "ADMIN" | "OWNER");
                  const r = await setStaffRole(id, next);
                  setMsg(r);
                  if (!r.ok) setValue(role);
                })
              }
            >
              {busy ? "Saving…" : "Save"}
            </button>
            {msg && (
              <span className={msg.ok ? "ok-txt" : "due-txt"} role="status">
                {msg.message}
              </span>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
