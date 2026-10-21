"use strict";
// Reviewed replacement for the one fast-glob call made by
// @next/eslint-plugin-next (dist/utils/get-root-dirs.js):
//   globSync(rootDirPattern, { onlyDirectories: true })
// It runs only when an ESLint config sets `settings.next.rootDir`, with a
// pattern from this repository's own configuration. Node's built-in
// fs.globSync replaces fast-glob -> micromatch -> braces, which has no patched
// release for GHSA-vfj7-8cjw-p6xm. Any option this shim does not implement
// throws instead of being silently ignored. See docs/security/.
const fs = require("node:fs");
const path = require("node:path");

const SUPPORTED_OPTIONS = new Set(["cwd", "onlyDirectories", "onlyFiles", "absolute"]);

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function globSync(source, options = {}) {
  for (const key of Object.keys(options)) {
    if (!SUPPORTED_OPTIONS.has(key)) throw new TypeError(`fast-glob shim: unsupported option "${key}"`);
  }
  const patterns = (Array.isArray(source) ? source : [source]).map(pattern => {
    if (typeof pattern !== "string") throw new TypeError("fast-glob shim: patterns must be strings");
    return pattern.replace(/\\/g, "/");
  });
  const cwd = options.cwd ?? process.cwd();
  // fast-glob defaults: onlyFiles unless onlyDirectories; dot entries excluded
  // (fs.globSync cannot match them with wildcards, so `dot: true` is rejected).
  const onlyDirectories = options.onlyDirectories === true;
  const onlyFiles = !onlyDirectories && options.onlyFiles !== false;
  const results = new Set();
  for (const pattern of patterns) {
    for (const match of fs.globSync(pattern, { cwd })) {
      const segments = toPosix(match).split("/");
      if (segments.some(segment => segment.startsWith(".") && segment !== "." && segment !== "..")) continue;
      const resolved = path.resolve(cwd, match);
      let stats;
      try { stats = fs.statSync(resolved); } catch { continue; }
      if (onlyDirectories && !stats.isDirectory()) continue;
      if (onlyFiles && !stats.isFile()) continue;
      results.add(options.absolute === true ? toPosix(resolved) : toPosix(match));
    }
  }
  return [...results];
}

function fastGlob(source, options) {
  return new Promise((resolve, reject) => {
    try { resolve(globSync(source, options)); } catch (error) { reject(error); }
  });
}

fastGlob.globSync = globSync;
fastGlob.sync = globSync;
fastGlob.glob = fastGlob;
fastGlob.async = fastGlob;
module.exports = fastGlob;
