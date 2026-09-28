"use client";

import { Suspense, useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import SplitShell, { BRAND_IMAGES } from "@/components/customer/SplitShell";
import {
  Field,
  Input,
  PasswordInput,
  Button,
  Banner,
} from "@/components/customer/Field";
import { linkClientAccount } from "../actions/linkClientAccount";

function SetupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = authClient.useSession();

  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [name, setName] = useState(searchParams.get("name") ?? "");
  const [phone, setPhone] = useState(searchParams.get("phone") ?? "");
  const [address, setAddress] = useState(searchParams.get("address") ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (session.data?.session) {
      router.replace("/");
    }
  }, [session.data?.session, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (!email.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!phone.trim()) {
      setError("Please enter a mobile number so our team can reach you.");
      return;
    }
    if (!address.trim()) {
      setError("Please enter your address so we know where to clean.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const res = await authClient.signUp.email({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
      });
      if (res.error) {
        setError(
          res.error.message ||
            "Couldn't create account. If you've used this email before, try signing in."
        );
        setLoading(false);
        return;
      }
      const link = await linkClientAccount({
        phone: phone.trim(),
        address: address.trim(),
      });
      if (!link.success) {
        setError(
          link.error ?? "Account created but linking failed. Please contact us."
        );
        setLoading(false);
        return;
      }
      router.push("/");
    } catch {
      setError("Unexpected error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <SplitShell
      image={BRAND_IMAGES.setup}
      quoteHtml={"You're <em>two minutes</em><br/>from a cleaner home."}
      quoteSub="Set a password and we'll save your details for next time."
      topRightLabel="Already have an account? Sign in"
      topRightHref="/login"
      badge="Account setup">
      <header style={{ marginBottom: 36 }}>
        <p className="cl-eyebrow" style={{ marginBottom: 12 }}>
          Welcome
        </p>
        <h1 className="cl-display">
          Set up your
          <br />
          <em>account.</em>
        </h1>
        <p className="cl-subtitle">
          A password lets you manage bookings online — and we'll have it ready
          for your cleaning team.
        </p>
      </header>

      <form className="cl-stack-20" onSubmit={onSubmit} noValidate>
        <Field label="Full name" htmlFor="setup-name">
          <Input
            id="setup-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field label="Email" htmlFor="setup-email">
          <Input
            id="setup-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label="Mobile number" htmlFor="setup-phone">
          <Input
            id="setup-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            placeholder="(514) 555-0123"
          />
        </Field>

        <Field label="Address" htmlFor="setup-address">
          <Input
            id="setup-address"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoComplete="street-address"
            placeholder="Street, city, postal code"
          />
        </Field>

        <Field
          label="Password"
          htmlFor="setup-pwd"
          hint="At least 8 characters">
          <PasswordInput
            id="setup-pwd"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </Field>

        <Field label="Confirm password" htmlFor="setup-pwd2">
          <PasswordInput
            id="setup-pwd2"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </Field>

        {error ? <Banner kind="error">{error}</Banner> : null}

        <Button type="submit" size="lg" block loading={loading}>
          {loading ? "Creating account…" : "Create account →"}
        </Button>

        <div className="cl-divider" />

        <div
          style={{
            textAlign: "center",
            fontSize: 13,
            color: "var(--primary-70)",
          }}>
          Already have an account?{" "}
          <Link href="/login" className="cl-link">
            Sign in instead
          </Link>
        </div>
      </form>
    </SplitShell>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={null}>
      <SetupForm />
    </Suspense>
  );
}
