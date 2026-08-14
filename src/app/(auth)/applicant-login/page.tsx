"use client";

import { Suspense, useEffect, useState, FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import SplitShell, { BRAND_IMAGES } from "@/components/customer/SplitShell";
import CleanoLoader from "@/components/ui/CleanoLoader";
import {
  Field,
  Input,
  PasswordInput,
  Button,
  Banner,
} from "@/components/customer/Field";

const CALLBACK = "/api/post-signin?from=applicant";

function ApplicantLoginInner() {
  const session = authClient.useSession();
  const searchParams = useSearchParams();

  // Explain a wrong-role bounce from /api/post-signin, or a just-activated
  // account arriving from the invite flow.
  const errorParam = searchParams.get("error");
  const initialError =
    errorParam === "not_applicant" || errorParam === "use_applicant_login"
      ? "That account isn't an applicant portal account."
      : null;
  const activated = searchParams.get("activated") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
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
        <CleanoLoader fullscreen size={72} messages={["Signing you in…"]} />
      )}
      <SplitShell
        image={BRAND_IMAGES.setup}
        quoteHtml={"Your next step<br/>starts with a<br/><em>single sign-in.</em>"}
        quoteSub="Track your application, upload documents, and hear back — all in one place."
        badge="Applicant portal">
        <header style={{ marginBottom: 36 }}>
          <p className="cl-eyebrow" style={{ marginBottom: 12 }}>
            Welcome
          </p>
          <h1 className="cl-display">
            Sign in to your
            <br />
            <em>application.</em>
          </h1>
          <p className="cl-subtitle">
            This is where you&apos;ll track your application status and complete
            onboarding steps.
          </p>
        </header>

        <form className="cl-stack-20" onSubmit={onSubmit} noValidate>
          {activated ? (
            <Banner kind="success">
              Your password is set. Sign in below to continue.
            </Banner>
          ) : null}

          <Field label="Email" htmlFor="applicant-login-email">
            <Input
              id="applicant-login-email"
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

          <Field label="Password" htmlFor="applicant-login-password">
            <PasswordInput
              id="applicant-login-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              placeholder="••••••••"
            />
          </Field>

          {error ? <Banner kind="error">{error}</Banner> : null}

          <Button type="submit" size="lg" block loading={loading}>
            {loading ? "Signing in…" : "Sign in →"}
          </Button>

          <p style={{ fontSize: 13, textAlign: "center", color: "var(--primary-70)" }}>
            You&apos;ll only have an account here once an admin has sent you a
            portal invite by email.
          </p>
        </form>
      </SplitShell>
    </>
  );
}

export default function ApplicantLoginPage() {
  return (
    <Suspense fallback={null}>
      <ApplicantLoginInner />
    </Suspense>
  );
}
