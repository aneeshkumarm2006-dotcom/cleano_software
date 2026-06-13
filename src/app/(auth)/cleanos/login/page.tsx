"use client";

import { Suspense, useEffect, useState, FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import SplitShell from "@/components/customer/SplitShell";
import CleanoLoader from "@/components/ui/CleanoLoader";
import {
  Field,
  Input,
  PasswordInput,
  Button,
  Banner,
} from "@/components/customer/Field";

const CALLBACK = "/api/post-signin?from=cleaner";

function CleanerLoginInner() {
  const session = authClient.useSession();
  const searchParams = useSearchParams();

  const rememberedKey = "cleano_remember_email";
  const initialEmail =
    typeof window !== "undefined"
      ? localStorage.getItem(rememberedKey) ?? ""
      : "";

  // Explain a wrong-role bounce from /api/post-signin.
  const errorParam = searchParams.get("error");
  const initialError =
    errorParam === "not_cleaner" || errorParam === "use_cleaner_login"
      ? "That account isn't a cleaner account. If you're an admin, use the staff sign-in."
      : null;

  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(Boolean(initialEmail));
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (session.data?.session) {
      setRedirecting(true);
      window.location.href = CALLBACK;
    }
  }, [session.data?.session]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await authClient.signIn.email({
        email: email.trim().toLowerCase(),
        password,
        callbackURL: CALLBACK,
      });
      if (res.error) {
        const code = res.error.status;
        if (code === 401) setError("Email or password is incorrect.");
        else if (code === 429)
          setError("Too many attempts. Please wait a few minutes.");
        else setError(res.error.message || "Couldn't sign in.");
        setLoading(false);
        return;
      }
      if (remember) localStorage.setItem(rememberedKey, email);
      else localStorage.removeItem(rememberedKey);
      setRedirecting(true);
      window.location.href = CALLBACK;
    } catch {
      setError("Unexpected error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <>
      {(loading || redirecting) && (
        <CleanoLoader
          fullscreen
          size={72}
          messages={["Signing you in…", "Loading your jobs…"]}
        />
      )}
    <SplitShell
      image="/employee-login.png"
      imagePosition="center top"
      quoteHtml={"Great work<br/>starts with a<br/><em>great team.</em>"}
      quoteSub="Your jobs, your schedule, and your pay — all in one place."
      badge="Cleaner portal">
      <header style={{ marginBottom: 36 }}>
        <p className="cl-eyebrow" style={{ marginBottom: 12 }}>
          Welcome back
        </p>
        <h1 className="cl-display">
          Sign in to
          <br />
          your <em>team account.</em>
        </h1>
        <p className="cl-subtitle">
          View your jobs, track your pay, and manage your schedule.
        </p>
      </header>

      <form className="cl-stack-20" onSubmit={onSubmit} noValidate>
        <Field label="Email" htmlFor="login-email">
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
          />
        </Field>

        <Field label="Password" htmlFor="login-password">
          <PasswordInput
            id="login-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            placeholder="••••••••"
          />
        </Field>

        <div className="cl-row-between" style={{ fontSize: 13 }}>
          <label className="cl-check-row">
            <input
              type="checkbox"
              className="cl-check"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>Remember me</span>
          </label>
          <a
            href="#"
            className="cl-link-muted"
            onClick={(e) => {
              e.preventDefault();
              setNotice("Forgot password? Please contact your manager.");
            }}
            style={{ fontSize: 13 }}>
            Forgot password?
          </a>
        </div>

        {error ? <Banner kind="error">{error}</Banner> : null}
        {notice ? <Banner kind="amber">{notice}</Banner> : null}

        <Button type="submit" size="lg" block loading={loading}>
          {loading ? "Signing in…" : "Sign in →"}
        </Button>
      </form>
    </SplitShell>
    </>
  );
}

export default function CleanerLoginPage() {
  return (
    <Suspense fallback={null}>
      <CleanerLoginInner />
    </Suspense>
  );
}
