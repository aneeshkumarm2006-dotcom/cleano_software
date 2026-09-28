// ESLint flat config for Next.js apps (apps/web).
//
// eslint-config-next still ships in the legacy "extends" format, so it is
// adapted through FlatCompat. baseDirectory is this package, which is where
// eslint-config-next is declared as a dependency.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
];
