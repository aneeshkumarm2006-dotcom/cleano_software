"use client";

import { Suspense, useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import SplitShell, { BRAND_IMAGES } from "@/components/customer/SplitShell";
import { Field, PasswordInput, Button, Banner } from "@/components/customer/Field";
import { setNewPassword } from "../actions/setNewPassword";

function ChangePasswordForm() {
  const router = useRouter();
  const session = authClient.useSession();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Must be signed in to set a new password.
  useEffect(() => {
    if (!session.isPending && !session.data?.session) {
      router.replace("/login");
    }
  }, [session.isPending, session.data?.session, router]);

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
    const res = await setNewPassword({ password, confirm });
    if (!res.success) {
      setError(res.error);
      setLoading(false);
      return;
    }
    // Full navigation so the secured layout re-reads the cleared flag.
    window.location.href = "/";
  }

  return (
    <SplitShell
      image={BRAND_IMAGES.setup}
      quoteHtml={"One quick step<br/>to secure your account."}
      quoteSub="Choose a password only you know."
      badge="Set your password">
      <header style={{ marginBottom: 36 }}>
        <p className="cl-eyebrow" style={{ marginBottom: 12 }}>
          Welcome to Cleano
        </p>
        <h1 className="cl-display">
          Set your
          <br />
          <em>password.</em>
        </h1>
        <p className="cl-subtitle">
          Your account was set up with a temporary password. Please choose a new
          one to finish — you'll use it to sign in from now on.
        </p>
      </header>

      <form className="cl-stack-20" onSubmit={onSubmit} noValidate>
        <Field label="New password" htmlFor="cp-pwd" hint="At least 8 characters">
          <PasswordInput
            id="cp-pwd"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </Field>

        <Field label="Confirm new password" htmlFor="cp-pwd2">
          <PasswordInput
            id="cp-pwd2"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </Field>

        {error ? <Banner kind="error">{error}</Banner> : null}

        <Button type="submit" size="lg" block loading={loading}>
          {loading ? "Saving…" : "Save password →"}
        </Button>
      </form>
    </SplitShell>
  );
}

export default function ChangePasswordPage() {
  return (
    <Suspense fallback={null}>
      <ChangePasswordForm />
    </Suspense>
  );
}
