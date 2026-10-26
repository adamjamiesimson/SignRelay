import { describe, expect, it } from "vitest";
import { commandFor } from "../scripts/run-command.mjs";

describe("portable npm invocation", () => {
  const env = { ...process.env, npm_execpath: "C:\\Program Files\\npm\\bin\\npm-cli.js" };
  it("runs Windows npm/npx through Node without shell parsing arguments", () => {
    const args = ["run", "check", "--", "a path & $(literal)"];
    expect(commandFor("npm", args, "win32", env)).toEqual([process.execPath, [env.npm_execpath, ...args]]);
    expect(commandFor("npx", ["next", "build"], "win32", env)).toEqual([
      process.execPath, ["C:\\Program Files\\npm\\bin\\npx-cli.js", "next", "build"],
    ]);
  });
  it("retains ordinary executables and POSIX npm invocation", () => {
    expect(commandFor("node", ["script.mjs"], "win32", env)).toEqual(["node", ["script.mjs"]]);
    expect(commandFor("npm", ["test"], "linux", env)).toEqual(["npm", ["test"]]);
  });
});
