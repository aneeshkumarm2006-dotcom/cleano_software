"use client";

import { useState, FormEvent } from "react";
import { consumeApplicantInvite } from "./actions";
import {
  Field,
  PasswordInput,
  Button,
  Banner,
} from "@/components/customer/Field";

export default function SetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const res = await consumeApplicantInvite({ token, password, confirm });
    if (!res.success) {
      setError(res.error);
      setLoading(false);
      return;
    }
    window.location.href = "/applicant-login?activated=1";
  }

  return (
    <form className="cl-stack-20" onSubmit={onSubmit} noValidate>
      <Field
        label="Password"
        htmlFor="invite-password"
        hint="At least 8 characters.">
        <PasswordInput
          id="invite-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          placeholder="••••••••"
          autoComplete="new-password"
        />
      </Field>

      <Field label="Confirm password" htmlFor="invite-confirm">
        <PasswordInput
          id="invite-confirm"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setError(null);
          }}
          placeholder="••••••••"
          autoComplete="new-password"
        />
      </Field>

      {error ? <Banner kind="error">{error}</Banner> : null}

      <Button type="submit" size="lg" block loading={loading}>
        {loading ? "Setting password…" : "Set password & continue →"}
      </Button>
    </form>
  );
}
