"use client";

import { Suspense, useState, FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import SplitShell, { BRAND_IMAGES } from "@/components/customer/SplitShell";
import { Field, PasswordInput, Button, Banner } from "@/components/customer/Field";

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  // better-auth redirects the email link to ?token=… (or ?error=… if invalid).
  const token = searchParams.get("token");
  const linkError = searchParams.get("error");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const badLink = !token || !!linkError;

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
    if (!token) return;
    setLoading(true);
    const res = await authClient.resetPassword({ newPassword: password, token });
    if (res.error) {
      setError(
        res.error.message ||
          "This reset link is invalid or has expired. Please request a new one."
      );
      setLoading(false);
      return;
    }
    // Success → back to sign in with a confirmation banner.
    window.location.href = "/login?reset=success";
  }

  return (
    <SplitShell
      image={BRAND_IMAGES.setup}
      quoteHtml={"Almost there —<br/>pick a <em>new password.</em>"}
      quoteSub="Choose something only you know."
      topRightLabel="Back to sign in"
      topRightHref="/login"
      badge="Password reset">
      <header style={{ marginBottom: 36 }}>
        <p className="cl-eyebrow" style={{ marginBottom: 12 }}>
          Choose a new password
        </p>
        <h1 className="cl-display">
          Set a new
          <br />
          <em>password.</em>
        </h1>
        <p className="cl-subtitle">
          Pick a password you'll use to sign in to your Cleano portal.
        </p>
      </header>

      {badLink ? (
        <div className="cl-stack-20">
          <Banner kind="error">
            This reset link is invalid or has expired. Reset links are valid for 1
            hour — please request a fresh one.
          </Banner>
          <Link href="/forgot-password" className="cl-link">
            Request a new reset link →
          </Link>
        </div>
      ) : (
        <form className="cl-stack-20" onSubmit={onSubmit} noValidate>
          <Field label="New password" htmlFor="rp-pwd" hint="At least 8 characters">
            <PasswordInput
              id="rp-pwd"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>

          <Field label="Confirm new password" htmlFor="rp-pwd2">
            <PasswordInput
              id="rp-pwd2"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>

          {error ? <Banner kind="error">{error}</Banner> : null}

          <Button type="submit" size="lg" block loading={loading}>
            {loading ? "Saving…" : "Save new password →"}
          </Button>
        </form>
      )}
    </SplitShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}
