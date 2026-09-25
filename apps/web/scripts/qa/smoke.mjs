/** Prove the harness: sign in as each role and load a couple of pages. */
import { open, signIn, visit, report } from "./harness.mjs";

const { browser, page, problems } = await open();
const out = [];
try {
  out.push({ step: "admin signIn", landed: await signIn(page, "admin") });
  out.push(await visit(page, "/admin/dashboard"));
  out.push(await visit(page, "/admin/issues"));

  const ctx2 = await open();
  try {
    out.push({ step: "cleaner signIn", landed: await signIn(ctx2.page, "cleaner1") });
    out.push(await visit(ctx2.page, "/cleaners/my-jobs"));
    problems.push(...ctx2.problems);
  } finally {
    await ctx2.browser.close();
  }
} catch (e) {
  out.push({ fatal: String(e).slice(0, 600) });
} finally {
  await browser.close();
}
report("smoke", out.map((o) => ({ ...o, text: o.text ? o.text.slice(0, 300) : undefined })), problems);
