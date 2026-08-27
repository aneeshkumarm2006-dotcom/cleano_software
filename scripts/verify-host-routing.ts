/**
 * Which company does a web address belong to, and what may be served on it?
 *
 *   npx tsx scripts/verify-host-routing.ts
 *
 * Pure functions, no database, so this runs in under a second and can be run
 * before every deploy. It exists because these two rules decide, on every
 * single request, whose data is about to be loaded — and both of them are the
 * kind of string handling that looks obviously correct and quietly is not.
 *
 * The environment is cleared before the module is imported: the point is to
 * check the DEFAULTS, and a stray DEFAULT_ORG_SLUG in a shell would otherwise
 * make this pass while production behaved differently.
 */
delete process.env.DEFAULT_ORG_SLUG;
delete process.env.LEGACY_ORG_SLUG;

let pass = 0,
  fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  if (got === want) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
};

(async () => {
  const { orgSlugFromHost, isPlatformPath, workspaceOriginFor, PLATFORM_ORG_SLUG } =
    await import("../src/lib/tenant");
  const P = PLATFORM_ORG_SLUG;

  console.log("\nWHICH COMPANY DOES THIS ADDRESS BELONG TO?");
  // The whole point of the change: the bare domain is no longer a customer.
  check("useawer.com -> Awer itself", orgSlugFromHost("useawer.com"), P);
  check("www.useawer.com -> Awer itself", orgSlugFromHost("www.useawer.com"), P);
  check("USEAWER.COM (shouting) -> Awer itself", orgSlugFromHost("USEAWER.COM"), P);
  check("useawer.com. (trailing dot) -> Awer itself", orgSlugFromHost("useawer.com."), P);

  check("teamcleano.useawer.com -> teamcleano", orgSlugFromHost("teamcleano.useawer.com"), "teamcleano");
  check("acme.useawer.com -> acme", orgSlugFromHost("acme.useawer.com"), "acme");
  check("platform.useawer.com -> Awer itself", orgSlugFromHost("platform.useawer.com"), P);

  console.log("\n  local development");
  check("localhost:3000 -> Awer itself", orgSlugFromHost("localhost:3000"), P);
  check("teamcleano.localhost:3000 -> teamcleano", orgSlugFromHost("teamcleano.localhost:3000"), "teamcleano");

  console.log("\n  addresses that carry no company at all");
  check("a preview build URL", orgSlugFromHost("awer-git-abc123.vercel.app"), P);
  check("a bare IP", orgSlugFromHost("203.0.113.4:3000"), P);
  check("no host header", orgSlugFromHost(null), P);
  check("empty host header", orgSlugFromHost(""), P);

  console.log("\nWHAT MAY BE SERVED ON AWER'S OWN FRONT DOOR?");
  for (const p of ["/get-started", "/get-started/organization", "/console", "/console/workspaces", "/sign-in", "/workspace-unavailable"]) {
    check(`${p} — yes, it is Awer's`, isPlatformPath(p), true);
  }
  console.log("\n  a company's application — kept off it");
  for (const p of ["/", "/admin", "/admin/dashboard", "/cleaners/dashboard", "/cleanos/login", "/login", "/bookings/abc", "/book", "/careers", "/rate/tok", "/sign-up", "/applicant-login"]) {
    check(`${p} — no, it belongs to a company`, isPlatformPath(p), false);
  }
  console.log("\n  a prefix must not match a longer word");
  // "/console" must not let "/consoles" through, and "/sign-in" must not let
  // "/sign-in-as-anyone" through. startsWith on its own does exactly that.
  check("/consoles is NOT the console", isPlatformPath("/consoles"), false);
  check("/sign-inbox is NOT the sign-in page", isPlatformPath("/sign-inbox"), false);
  check("/designs is NOT the design page", isPlatformPath("/designs"), false);

  console.log("\nWHERE DOES AN OLD BOOKMARK GET FORWARDED TO?");
  check("from the bare domain", workspaceOriginFor("teamcleano", "useawer.com", "https"), "https://teamcleano.useawer.com");
  check("from www", workspaceOriginFor("teamcleano", "www.useawer.com", "https"), "https://teamcleano.useawer.com");
  check("locally, keeping the port", workspaceOriginFor("teamcleano", "localhost:3000", "http"), "http://teamcleano.localhost:3000");
  // Where subdomains cannot work, the proxy must fall back rather than send
  // someone to an address that does not resolve.
  check("a preview build URL has nowhere to forward to", workspaceOriginFor("teamcleano", "x.vercel.app", "https"), null);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((e) => {
  console.error("ERROR:", e);
  process.exitCode = 1;
});
