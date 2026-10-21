// One entry point per build profile. `full` is the existing multilingual
// Firebase build (unchanged, including the RSL install). `asl-demo` skips the
// RSL download and non-ASL asset checks, builds with the profile baked in,
// prunes other language models, then verifies the exact runtime.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const STEPS = {
  "asl-demo": [
    ["node", "scripts/verify-vision-runtime.mjs"],
    ["node", "scripts/prepare-export.mjs"],
    ["node", "scripts/install-vision-assets.mjs"],
    ["npm", "run", "build:worker"],
    ["npx", "next", "build"],
    ["node", "scripts/exclude-private-routes.mjs"],
    ["node", "scripts/prune-profile.mjs", "asl-demo"],
    ["node", "scripts/secure-export.mjs"],
    ["node", "scripts/verify-runtime.mjs", "--out", "out", "--profile", "asl-demo"],
  ],
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const profile = process.argv[2];
  if (!STEPS[profile]) throw new Error(`Usage: node scripts/build-profile.mjs ${Object.keys(STEPS).join("|")} (the full build is npm run build:firebase)`);
  // The offline demo must make no third-party requests, so analytics is never configured.
  const env = { ...process.env, NEXT_PUBLIC_SIGNRELAY_PROFILE: profile, NEXT_PUBLIC_GA_MEASUREMENT_ID: "" };
  for (const [command, ...args] of STEPS[profile]) {
    console.log(`\n▶ ${command} ${args.join(" ")}`);
    const result = spawnSync(command, args, { stdio: "inherit", env });
    if (result.status !== 0) { console.error(`Profile ${profile} build failed at: ${command} ${args.join(" ")}`); process.exit(result.status ?? 1); }
  }
  console.log(`\nProfile ${profile} export ready in out/ (runtime-manifest.json records exactly what it contains).`);
}
