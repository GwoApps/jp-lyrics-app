import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // App Router root layouts load this stylesheet globally; the Pages Router warning is not applicable.
      "@next/next/no-page-custom-font": "off",
      // Use the shared randomId() helper; raw crypto.randomUUID breaks on http.
      "no-restricted-properties": ["error", {
        object: "crypto",
        property: "randomUUID",
        message: "Use randomId() from @/lib/random-id instead.",
      }, {
        object: "globalThis.crypto",
        property: "randomUUID",
        message: "Use randomId() from @/lib/random-id instead.",
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".open-next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
