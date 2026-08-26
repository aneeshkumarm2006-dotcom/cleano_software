"use client";

import { Suspense, useEffect, useState, FormEvent } from "react";
import Link from "next/link";
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

const CALLBACK = "/api/post-signin";

function SignInInner() {
  const session = authClient.useSession();
  const searchParams = useSearchParams();

  const rememberedKey = "cleano_remember_email";

  // Arriving from signup on another host: the workspace was just created, and
  // the session cookie could not follow across the subdomain boundary. Carry the
  // address over so the owner's first act here is typing one thing, not two.
  const welcomed = searchParams.get("welcome") === "1";
  const handoffEmail = searchParams.get("email") ?? "";

  const initialEmail =
    handoffEmail ||
    (typeof window !== "undefined" ? localStorage.getItem(rememberedKey) ?? "" : "");

  // Explain a wrong-role bounce from /api/post-signin.
  const errorParam = searchParams.get("error");
  const initialError =
    errorParam === "no_access"
      ? "This account doesn't have staff access. If you're a cleaner, use the cleaner login."
      : null;

  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(Boolean(initialEmail));
  const [error, setError] = useState<string | null>(initialError);
  const [notice, setNotice] = useState<string | null>(
    welcomed ? "Your workspace is ready. Sign in to open it." : null,
  );
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
          messages={["Signing you in…", "Loading your dashboard…"]}
        />
      )}
    <SplitShell
      image="/admin-login.png"
      quoteHtml={"Run the whole<br/>operation <em>from<br/>one place.</em>"}
      quoteSub="Bookings, schedules, payments, and your team — all in one dashboard."
      topRightLabel="Cleaner sign in →"
      topRightHref="/cleanos/login"
      badge="Admin & staff">
      <header style={{ marginBottom: 36 }}>
        <p className="cl-eyebrow" style={{ marginBottom: 12 }}>
          Welcome back
        </p>
        <h1 className="cl-display">
          Sign in to
          <br />
          your <em>dashboard.</em>
        </h1>
        <p className="cl-subtitle">
          Manage bookings, your team, and daily operations.
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
              setNotice("Forgot password? Please contact your administrator.");
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

        <div className="cl-divider-or" style={{ marginTop: 8 }}>
          or
        </div>

        <div
          className="cl-stack-12"
          style={{
            textAlign: "center",
            fontSize: 14,
            color: "var(--primary-70)",
            lineHeight: 1.6,
          }}>
          <div style={{ fontSize: 13 }}>
            Are you a cleaner?{" "}
            <Link href="/cleanos/login" className="cl-link">
              Log in here →
            </Link>
          </div>
        </div>
      </form>
    </SplitShell>
    </>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInInner />
    </Suspense>
  );
}
