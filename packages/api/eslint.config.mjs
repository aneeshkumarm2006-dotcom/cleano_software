import library from "@bookmops/eslint-config/library";

// The contract runs on the server and in both apps, so it keeps core's rules.
// The one exception is the client, whose whole job is `fetch`.
export default [
  ...library,
  {
    files: ["src/client/request.ts"],
    rules: { "no-restricted-globals": "off" },
  },
];
