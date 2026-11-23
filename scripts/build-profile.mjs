// Bake the selected profile into every build. The ASL profiles skip the RSL
// download and non-ASL asset checks, then prune other languages' runtime assets.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function buildSteps(profile) {
  const full = profile === "full";
  return [
    ["node", "scripts/verify-vision-runtime.mjs"],
    ...(full ? [
      ["npm", "run", "install:rsl-model"],
      ["node", "scripts/verify-bdsl-assets.mjs"],
      ["node", "scripts/verify-lse-assets.mjs"],
      ["node", "scripts/verify-psl-assets.mjs"],
    ] : []),
    ["node", "scripts/prepare-export.mjs"],
    ["node", "scripts/install-vision-assets.mjs"],
    ["npm", "run", "build:worker"],
    [process.execPath, "node_modules/next/dist/bin/next", "build"],
    ["node", "scripts/exclude-private-routes.mjs"],
    ...(full ? [] : [["node", "scripts/prune-profile.mjs", profile]]),
    ["node", "scripts/secure-export.mjs"],
    ["node", "scripts/verify-runtime.mjs", "--out", "out", "--profile", profile, "--record-revision"],
  ];
}

export const STEPS = Object.fromEntries(["full", "asl-demo", "rehearsal"].map(profile => [profile, buildSteps(profile)]));

/** @param {string} profile @param {Record<string, string | undefined>} [env] */
export function profileEnvironment(profile, env = process.env) {
  return { ...env, NEXT_PUBLIC_SIGNRELAY_PROFILE: profile,
    ...(profile === "full" ? {} : { NEXT_PUBLIC_GA_MEASUREMENT_ID: "" }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const profile = process.argv[2];
  if (!Object.hasOwn(STEPS, profile)) throw new Error(`Usage: node scripts/build-profile.mjs ${Object.keys(STEPS).join("|")}`);
  // The offline demo must make no third-party requests, so analytics is never configured.
  const env = profileEnvironment(profile);
  for (const [command, ...args] of STEPS[profile]) {
    console.log(`\n▶ ${command} ${args.join(" ")}`);
    const result = spawnSync(command, args, { stdio: "inherit", env });
    if (result.status !== 0) { console.error(`Profile ${profile} build failed at: ${command} ${args.join(" ")}`); process.exit(result.status ?? 1); }
  }
  console.log(`\nProfile ${profile} export ready in out/ (runtime-manifest.json records exactly what it contains).`);
}
