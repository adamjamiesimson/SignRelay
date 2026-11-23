import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // CommonJS shims loaded with require() by locked third-party tooling.
    files: ["tooling/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "work/**",
    "outputs/**",
    "next-env.d.ts",
    "public/wasm/**",
    // Copied from the locked @mediapipe/tasks-vision package at build time.
    "public/vision/**",
    "public/workers/*.js",
    "public/workers/*.mjs",
  ]),
]);

export default eslintConfig;
