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
    // Engine V3 lab build output (bundled MediaPipe / ONNX Runtime) and local test tooling links
    "engine-v3/web/dist/**",
    "engine-v3/parity/node_modules/**",
    "public/wasm/**",
    // Copied from the locked @mediapipe/tasks-vision package at build time.
    "public/vision/**",
    "public/workers/*.js",
    "public/workers/*.mjs",
  ]),
]);

export default eslintConfig;
