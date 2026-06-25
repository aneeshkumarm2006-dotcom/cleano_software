"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import SplitShell from "@/components/customer/SplitShell";
import { Field, Input, Button, Banner } from "@/components/customer/Field";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setLoading(true);
    // better-auth emails a reset link (sendResetPassword) that lands on
    // /reset-password?token=…. We always show the same success state
    // afterwards so the form can't be used to probe which emails exist.
    const res = await authClient.requestPasswordReset({
      email: email.trim().toLowerCase(),
      redirectTo: "/reset-password",
    });
    if (res.error && res.error.status === 429) {
      setError("Too many attempts. Please wait a few minutes and try again.");
      setLoading(false);
      return;
    }
    setSent(true);
    setLoading(false);
  }

  return (
    <SplitShell
      image="/forgot-password.png"
      imagePosition="center top"
      quoteHtml={"Locked out?<br/>We'll get you <em>back in.</em>"}
      quoteSub="Reset your password in a couple of clicks."
      topRightLabel="Back to sign in"
      topRightHref="/login"
      badge="Password reset">
      <header style={{ marginBottom: 36 }}>
        <p className="cl-eyebrow" style={{ marginBottom: 12 }}>
          Forgot password
        </p>
        <h1 className="cl-display">
          Reset your
          <br />
          <em>password.</em>
        </h1>
        <p className="cl-subtitle">
          Enter the email on your account and we'll send you a secure link to
          choose a new password.
        </p>
      </header>

      {sent ? (
        <div className="cl-stack-20">
          <Banner kind="success">
            If an account exists for <strong>{email.trim().toLowerCase()}</strong>,
            a password-reset link is on its way. Check your inbox (and spam) — the
            link expires in 1 hour.
          </Banner>
          <Link href="/login" className="cl-link">
            ← Back to sign in
          </Link>
        </div>
      ) : (
        <form className="cl-stack-20" onSubmit={onSubmit} noValidate>
          <Field label="Email" htmlFor="fp-email">
            <Input
              id="fp-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
            />
          </Field>

          {error ? <Banner kind="error">{error}</Banner> : null}

          <Button type="submit" size="lg" block loading={loading}>
            {loading ? "Sending…" : "Send reset link →"}
          </Button>

          <div
            style={{
              textAlign: "center",
              fontSize: 13,
              color: "var(--primary-70)",
            }}>
            Remembered it?{" "}
            <Link href="/login" className="cl-link">
              Sign in instead
            </Link>
          </div>
        </form>
      )}
    </SplitShell>
  );
}
