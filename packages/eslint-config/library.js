// ESLint flat config for platform-neutral packages (@bookmops/core).
//
// These packages run unchanged in a browser, in a React Native app with no
// signal, and on the server. The TypeScript base (library.json) already hides
// DOM and Node types; the rules below catch what types alone cannot: imports
// of platform packages, and reading the clock or locale behind the caller's
// back — a phone's clock can be wrong, so time must always be passed in.
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const PLATFORM_IMPORTS = [
  { group: ["node:*"], message: "Node built-ins are server-only. Keep this module platform-neutral." },
  { group: ["fs", "path", "os", "crypto", "child_process", "http", "https", "url", "stream", "util"], message: "Node built-ins are server-only." },
  { group: ["react", "react-dom", "react-native", "react-native-*"], message: "UI belongs in the apps or @bookmops/ui-native, not in core." },
  { group: ["next", "next/*"], message: "Next.js belongs in apps/web." },
  { group: ["@prisma/client", ".prisma/*", "@bookmops/db"], message: "The database never reaches core. Take plain values as arguments." },
  { group: ["server-only", "client-only"], message: "Core has no server/client split — it runs everywhere." },
  { group: ["@/*"], message: "'@/' is the web app's alias. Core imports only itself (relative) and its dependencies." },
];

export default [
  js.configs.recommended,
  ...tsPlugin.configs["flat/recommended"],
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { parser: tsParser },
    rules: {
      "no-restricted-imports": ["error", { patterns: PLATFORM_IMPORTS }],
      "no-restricted-globals": [
        "error",
        ...["process", "window", "document", "navigator", "localStorage", "sessionStorage", "fetch", "Buffer", "__dirname", "__filename", "require"].map(
          (name) => ({ name, message: `'${name}' is platform-specific. Take what you need as an argument.` }),
        ),
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "No implicit 'now' in core: take the current time as a parameter.",
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "No implicit 'now' in core: take the current time as a parameter.",
        },
        {
          selector: "CallExpression[callee.property.name=/^toLocale/][arguments.length=0]",
          message: "Pass an explicit locale: the default differs between a phone, a browser, and the server.",
        },
      ],
    },
  },
  {
    ignores: ["node_modules/**"],
  },
];
