/**
 * An invoice must carry THIS workspace's name and THIS workspace's tax
 * registration numbers.
 *
 * Two bugs, both found 2026-09-22 while checking CleanoCalgary:
 *
 *  1. The PDF read standalone `gstNumber` / `qstNumber` AppSetting keys. Those
 *     keys exist in no workspace, so no invoice this app has ever produced
 *     carried a registration number — including Montreal's, which has both
 *     saved correctly under `tax.config`. A Canadian business customer needs
 *     the supplier's GST number to claim their input tax credit.
 *  2. Calgary has no QST and typed "0" into the QST Number field to say so.
 *     "0" is a non-empty string, so the header read "QST: 0".
 *
 * And a third found on the way: the brand name was the literal "Cleano" in
 * both the PDF and the on-screen preview, so a second workspace's invoices went
 * out headed with another company's name.
 *
 * Database-free: reads source and exercises the pure helper.
 */
import { readFileSync } from "node:fs";
import { taxRegistrationNumber } from "../src/lib/tax";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) passed++;
  else failures.push(name);
};
const read = (p: string) => readFileSync(p, "utf8");

// --- the helper ---------------------------------------------------------
check("a real GST number survives", taxRegistrationNumber("710935420 RT 0001") === "710935420 RT 0001");
check('"0" is not a registration number', taxRegistrationNumber("0") === null);
check('"00" is not a registration number', taxRegistrationNumber("00") === null);
check('"N/A" is not a registration number', taxRegistrationNumber("N/A") === null);
check('"none" is not a registration number', taxRegistrationNumber("none") === null);
check("an empty string is absent", taxRegistrationNumber("") === null);
check("whitespace is absent", taxRegistrationNumber("   ") === null);
check("a non-string is absent", taxRegistrationNumber(undefined) === null);
check("surrounding whitespace is trimmed", taxRegistrationNumber("  123  ") === "123");
// A number that merely CONTAINS a zero must not be mistaken for the "0" case.
check("a number containing zeros survives", taxRegistrationNumber("1000000000") === "1000000000");

// --- the PDF ------------------------------------------------------------
const pdf = read("src/lib/invoice-pdf.ts");
check("PDF reads tax.config", pdf.includes('key: "tax.config"'));
check("PDF normalises through the helper", pdf.includes("taxRegistrationNumber("));
check(
  "PDF no longer takes the numbers from standalone keys alone",
  pdf.includes("legacy(") && !/const gstNumber =\s*\n?\s*typeof gstSetting/.test(pdf),
);
check("PDF takes its name from a setting", pdf.includes('getSetting("general.businessName")'));
check("PDF falls back to the workspace name", pdf.includes("orgName"));
check(
  "PDF does not hardcode the brand as its only source",
  !/name: "Cleano",/.test(pdf),
);

// --- the on-screen preview ---------------------------------------------
const preview = read("src/app/admin/invoices/InvoicePreview.tsx");
check("preview accepts a business name", /businessName\?: string;/.test(preview));
check(
  "preview renders the passed name",
  preview.includes('businessName?.trim() || "Cleano"'),
);

const detail = read("src/app/admin/invoices/[id]/InvoiceDetailView.tsx");
check("detail view passes the name down", /businessName=\{businessName\}/.test(detail));

// --- both server readers ------------------------------------------------
for (const p of [
  "src/app/admin/invoices/page.tsx",
  "src/app/admin/invoices/[id]/page.tsx",
]) {
  const src = read(p);
  check(`${p} normalises gstNumber`, src.includes("taxRegistrationNumber(raw?.gstNumber)"));
  check(`${p} normalises qstNumber`, src.includes("taxRegistrationNumber(raw?.qstNumber)"));
}

if (failures.length) {
  console.error(`✘ ${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.error(`   - ${f}`);
  process.exit(1);
}
console.log(`✔ ${passed} passed, 0 failed`);
