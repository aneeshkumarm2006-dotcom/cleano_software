/**
 * The Pier palette, and the token layer it rides on.
 *
 * Before this, colour was the one part of the design system that had no
 * system. There WAS a token block — --primary, --emerald-*, --amber-* — but
 * the components mostly walked around it: 1,847 literal copies of the brand
 * teal across 238 .tsx files, which meant "change the palette" was a
 * 1,847-file edit and therefore never happened.
 *
 * Now the value lives in one block and everything reads it. That is what
 * makes a second workspace's accent a one-line change instead of a fork.
 *
 * Three places genuinely CANNOT take a CSS variable, and each is asserted
 * here so a future sweep does not "fix" them into breakage:
 *
 *   src/app/icon.tsx, src/app/apple-icon.tsx  — Satori rasterises these to
 *     PNG at build time and does not implement custom properties. Getting
 *     this wrong fails `next build`, loudly, at /icon/512.
 *   src/app/layout.tsx themeColor            — a <meta> value read by the OS
 *     browser chrome, never by the CSS engine.
 *   src/components/ui/Chart.tsx              — recharts interpolates these
 *     strings itself.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) passed++;
  else failures.push(name);
};
const read = (p: string) => readFileSync(p, "utf8");

const css = read("src/app/globals.css");

/* ---- the palette is defined once --------------------------------------- */
{
  const want: [string, string][] = [
    ["--primary", "#0e7f8d"],
    ["--primary-deep", "#10242b"],
    ["--chrome", "#10242b"],
    ["--chrome-2", "#1b343d"],
    ["--chrome-ink", "#e7f0f2"],
    ["--chrome-muted", "#93aeb6"],
    ["--chrome-accent", "#4ccbd9"],
    ["--ground", "#f4f7f8"],
    ["--line", "#dbe4e7"],
    ["--ink", "#0b1418"],
    ["--ink-2", "#47606a"],
    ["--ink-3", "#64818b"],
    ["--success", "#1f7a4d"],
    ["--warning", "#8a5100"],
    ["--danger", "#ae2b2b"],
    ["--info", "#26557f"],
    ["--neutral-soft", "#edf2f3"],
  ];
  for (const [token, value] of want) {
    check(`${token} is ${value}`, new RegExp(`${token}\\s*:\\s*${value}\\s*;`, "i").test(css));
  }

  // The old hue-named families were repointed rather than renamed, so the
  // ~530 rules that already called them did not have to be touched. If any
  // of these drifts back to its stock Tailwind value the palette splits in
  // two and only half the app moves.
  const repointed: [string, string][] = [
    ["--emerald-700", "#1f7a4d"],
    ["--amber-800", "#8a5100"],
    ["--error", "#ae2b2b"],
    ["--blue-800", "#26557f"],
  ];
  for (const [token, value] of repointed) {
    check(`${token} follows Pier, not Tailwind`, new RegExp(`${token}\\s*:\\s*${value}\\s*;`, "i").test(css));
  }
}

/* ---- the dark chrome is the sidebar, not a one-off --------------------- */
{
  // No `s` flag: [^}] already spans newlines, and the project targets es2017.
  check("the sidebar rail paints the chrome token", /\.asidebar-rail\s*\{[^}]*background:\s*var\(--primary-deep\)/.test(css));
  // Comments still NAME the old navy, because two of them explain why it
  // went. What must not survive is a rule that still paints it.
  const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  check("no rule still paints the old navy", !/#19356[dD]/.test(cssRules));
}

/* ---- the components read the token, not a copy of its value ------------ */
{
  // Everything except the three documented exceptions. A hit here means
  // somebody pasted a hex where a token belongs, and that hex will not move
  // when the palette does.
  const EXEMPT = new Set([
    "src/components/ui/Chart.tsx",
    "src/app/icon.tsx",
    "src/app/apple-icon.tsx",
  ]);
  const MAPPED = new Set([
    "#008c9c", "#00707d", "#006975", "#00626d", "#007785", "#19356d",
    "#0d1b21", "#0e1a1c", "#46606a", "#dde6e8", "#f8fafb", "#f3f6f9",
    "#dc2626", "#fef2f2", "#fecaca", "#b91c1c", "#991b1b", "#fee2e2",
    "#059669", "#047857", "#065f46", "#d1fae5", "#a7f3d0", "#ecfdf5",
    "#d97706", "#b45309", "#92400e", "#fef3c7", "#fffbeb", "#fde68a",
    "#dbeafe", "#1e40af",
  ]);

  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!p.endsWith(".tsx")) continue;
      if (EXEMPT.has(p)) continue;
      const lines = read(p).split("\n");
      lines.forEach((line, i) => {
        const t = line.trim();
        // Comments may name a hex — several explain WHY a colour changed.
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
        // `var(--error, #b91c1c)` is token-first already; the hex is the
        // fallback for a context where the variable is not in scope.
        const bare = line.replace(/var\(--[a-z0-9-]+,\s*#[0-9a-fA-F]{6}\)/g, "");
        for (const m of bare.match(/#[0-9a-fA-F]{6}\b/g) ?? []) {
          if (MAPPED.has(m.toLowerCase())) offenders.push(`${p}:${i + 1} ${m}`);
        }
      });
    }
  };
  walk("src");
  check(
    `no component hardcodes a palette colour (${offenders.length} found)`,
    offenders.length === 0,
  );
  if (offenders.length) for (const o of offenders.slice(0, 10)) failures.push(`     ${o}`);
}

/* ---- the three places a variable cannot reach -------------------------- */
{
  for (const p of ["src/app/icon.tsx", "src/app/apple-icon.tsx"]) {
    const s = read(p);
    check(`${p} keeps a literal for Satori`, s.includes("#0e7f8d"));
    check(`${p} does not reach for a CSS variable`, !s.includes("var(--primary)"));
  }
  const layout = read("src/app/layout.tsx");
  check("browser chrome matches the sidebar", layout.includes('themeColor: "#10242B"'));
  check("the chart palette is left literal", read("src/components/ui/Chart.tsx").includes('"#008C9C"'));
}

/* ---- two states that used to wear the same pill ------------------------ */
{
  const jobs = read("src/app/admin/jobs/JobsView.tsx");
  const row = (key: string) => {
    const i = jobs.indexOf(`${key}:`);
    return i < 0 ? "" : jobs.slice(i, jobs.indexOf("\n", i));
  };
  const hold = row("ON_HOLD");
  const prog = row("IN_PROGRESS");
  check("On hold is still amber", hold.includes("--warning-soft") && hold.includes("--amber-800"));
  check("In Progress no longer borrows On hold's pill", !prog.includes("--warning-soft"));
  check("In Progress reads as the job happening now", prog.includes("--primary-10") && prog.includes("--primary-70"));
  check("Cancelled is neutral, not an alarm", (() => {
    const c = row("CANCELLED");
    return c.includes("--neutral-soft") && !c.includes("--danger");
  })());
  check("an unknown status falls back to the neutral pill",
    jobs.includes("map[status] || { label: status, bg: 'var(--neutral-soft)'"));
}

if (failures.length) {
  console.error(`✘ ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✔ ${passed} passed, 0 failed`);
