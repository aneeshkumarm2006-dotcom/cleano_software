"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";

import SplitShell, { BRAND_IMAGES } from "@/components/customer/SplitShell";
import AwerLogo from "@/components/AwerLogo";
import { Field, Input, PasswordInput, Button, Banner } from "@/components/customer/Field";

import { discoverWorkspaces, type DiscoveredWorkspace } from "./discover";

/**
 * Signing in at Awer's front door, where we do not yet know who you work for.
 *
 * Every other login in the product is on a company's own address, so the
 * workspace is already known from the host. Here it is not, and the person
 * arriving may be Awer staff or an admin who bookmarked the wrong thing.
 *
 * The flow is: take email AND password, prove them centrally, and only then say
 * which workspace they belong to. Asking for the password first is what keeps
 * this from being a way to enumerate other companies' staff -- see the note in
 * discover.ts. The password is then posted on to that workspace's own host,
 * because a session cookie cannot cross a subdomain boundary, which is the same
 * rule that keeps the tenants apart in the first place.
 */

const REMEMBERED = "awer_last_workspace";

export default function PlatformSignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<DiscoveredWorkspace[] | null>(null);
  const [remembered, setRemembered] = useState<string | null>(null);

  useEffect(() => {
    try {
      setRemembered(localStorage.getItem(REMEMBERED));
    } catch {
      // Private browsing, or storage blocked. The form below still works.
    }
  }, []);

  /**
   * Hand off to the workspace by submitting a real form to its host.
   *
   * It has to be a form POST rather than fetch: this is a top-level navigation
   * to another subdomain, and the point is for the response's Set-Cookie to
   * land on THAT host. A fetch would drop it.
   */
  function handOff(ws: DiscoveredWorkspace) {
    try {
      localStorage.setItem(REMEMBERED, ws.slug);
    } catch {
      // Not being able to remember is not a reason to fail the sign-in.
    }
    const form = document.createElement("form");
    form.method = "POST";
    form.action = `${ws.origin}/api/workspace-signin`;
    for (const [name, value] of [["email", email], ["password", password]]) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setChoices(null);
    setBusy(true);
    try {
      const res = await discoverWorkspaces(email, password);
      if (!res.ok) {
        setError(res.error);
        setBusy(false);
        return;
      }
      if (res.workspaces.length === 1) {
        handOff(res.workspaces[0]);
        return; // stay busy: the browser is navigating away
      }
      setChoices(res.workspaces);
      setBusy(false);
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <SplitShell
      logo={<AwerLogo onDark />}
      footNote={null}
      image={BRAND_IMAGES.home}
      quoteHtml={"Software for<br/><em>cleaning<br/>companies.</em>"}
      quoteSub="Sign in and we will take you to your workspace."
      badge="Awer">
      <header style={{ marginBottom: 36 }}>
        <p className="cl-eyebrow" style={{ marginBottom: 12 }}>
          Welcome back
        </p>
        <h1 className="cl-display">
          Sign in to
          <br />
          <span className="cl-display-accent">your workspace.</span>
        </h1>
      </header>

      {remembered && !choices ? (
        <p style={{ marginBottom: 20, fontSize: 13 }}>
          Last time you signed in to <strong>{remembered}</strong>.{" "}
          <Link href={`https://${remembered}.useawer.com/sign-in`} className="cl-link">
            Go straight there →
          </Link>
        </p>
      ) : null}

      {choices ? (
        <div>
          <Banner kind="amber">
            You are a member of {choices.length} workspaces. Which one?
          </Banner>
          <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
            {choices.map((ws) => (
              <button
                key={ws.slug}
                type="button"
                onClick={() => handOff(ws)}
                className="cl-choice">
                <strong>{ws.name}</strong>
                <span style={{ opacity: 0.65, fontSize: 13 }}>
                  {ws.slug}.useawer.com
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit}>
          {error ? <Banner kind="error">{error}</Banner> : null}
          <Field label="Email">
            <Input
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourcompany.com"
            />
          </Field>
          <Field label="Password">
            <PasswordInput
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? "Finding your workspace…" : "Sign in →"}
          </Button>
        </form>
      )}

      <div style={{ marginTop: 28, textAlign: "center", fontSize: 13 }}>
        New here? <Link href="/get-started" className="cl-link">Start a workspace →</Link>
      </div>
    </SplitShell>
  );
}
