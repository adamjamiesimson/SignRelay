import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 } from "node:path";

/** Windows cannot exec npm.cmd without a shell. Run the npm CLI through Node
 * instead, retaining argument boundaries (including paths containing spaces).
 * npm scripts supply npm_execpath; direct node invocations search normal PATH. */
export function commandFor(command, args, platform = process.platform, env = process.env) {
  if (platform !== "win32" || !["npm", "npx"].includes(command)) return [command, args];
  const npmCli = env.npm_execpath || (env.PATH ?? env.Path ?? "").split(";").flatMap(directory => [
    win32.join(directory, "npm-cli.js"), win32.join(directory, "node_modules/npm/bin/npm-cli.js"),
  ]).find(existsSync);
  if (!npmCli) throw new Error("npm CLI was not found. Run this command through npm or add its installation to PATH.");
  const cli = command === "npx" ? win32.join(win32.dirname(npmCli), "npx-cli.js") : npmCli;
  return [process.execPath, [cli, ...args]];
}
export function runCommandSync(command, args, options) {
  const [executable, argv] = commandFor(command, args, process.platform, options?.env ?? process.env);
  return spawnSync(executable, argv, options);
}
export function execCommandSync(command, args, options) {
  const [executable, argv] = commandFor(command, args, process.platform, options?.env ?? process.env);
  return execFileSync(executable, argv, options);
}
