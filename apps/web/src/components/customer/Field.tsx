"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label?: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="cl-field">
      {label ? (
        <label className="cl-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <div
          role="alert"
          style={{ fontSize: 12, color: "var(--error-text)" }}>
          {error}
        </div>
      ) : null}
      {hint ? (
        <div style={{ fontSize: 12, color: "var(--primary-50)" }}>{hint}</div>
      ) : null}
    </div>
  );
}

export function Input({
  error,
  className = "",
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  const cls = ["cl-input", error ? "error" : "", className]
    .filter(Boolean)
    .join(" ");
  return <input className={cls} {...rest} />;
}

export function Textarea({
  error,
  className = "",
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }) {
  const cls = ["cl-textarea", error ? "error" : "", className]
    .filter(Boolean)
    .join(" ");
  return <textarea className={cls} {...rest} />;
}

export function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  error,
  autoComplete = "current-password",
}: {
  id?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  error?: boolean;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="cl-input-wrap">
      <input
        id={id}
        type={show ? "text" : "password"}
        className={`cl-input ${error ? "error" : ""}`}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        className="cl-icon-btn"
        aria-label={show ? "Hide password" : "Show password"}
        onClick={() => setShow((v) => !v)}>
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  size,
  block,
  loading,
  disabled,
  type = "button",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "amber" | "dangerGhost";
  size?: "sm" | "lg";
  block?: boolean;
  loading?: boolean;
}) {
  const cls = [
    "cl-btn",
    variant === "primary"
      ? "cl-btn-primary"
      : variant === "secondary"
      ? "cl-btn-secondary"
      : variant === "ghost"
      ? "cl-btn-ghost"
      : variant === "amber"
      ? "cl-btn-amber"
      : variant === "dangerGhost"
      ? "cl-btn-danger-ghost"
      : "",
    size === "sm" ? "cl-btn-sm" : size === "lg" ? "cl-btn-lg" : "",
    block ? "cl-btn-block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type={type}
      className={cls}
      disabled={disabled || loading}
      {...rest}>
      {loading ? <span className="cl-spinner" /> : null}
      <span>{children}</span>
    </button>
  );
}

export function Banner({
  kind = "error",
  children,
}: {
  kind?: "error" | "success" | "amber";
  children: React.ReactNode;
}) {
  const cls =
    kind === "error"
      ? "cl-banner cl-banner-error"
      : kind === "success"
      ? "cl-banner cl-banner-success"
      : "cl-banner cl-banner-amber";
  return (
    <div className={cls} role="alert">
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
