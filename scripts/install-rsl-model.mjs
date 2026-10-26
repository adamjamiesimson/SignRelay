// Install the pinned Slovo RSL model (141 MB, not committed to Git) and
// verify its exact size and SHA-256. The download is external and sometimes
// resets mid-transfer, so transient network failures are retried a bounded
// number of times. Integrity failures are never retried and never installed.
//
// Exit codes: 0 installed or already valid; 65 the bytes did not match the
// pinned size or SHA-256 (fail closed); 75 the external host could not be
// reached or kept failing (temporary, not a code failure).
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

export const EXIT_INTEGRITY = 65;
export const EXIT_EXTERNAL = 75;
export const RETRY_DELAYS_MS = [5000, 15000, 45000];

/** The downloaded bytes are not the pinned model. Never retried. */
export class IntegrityError extends Error {}
/** The external host failed or refused. Transient ones are retried. */
export class ExternalDownloadError extends Error {
  constructor(message, { transient, cause } = {}) { super(message, { cause }); this.transient = transient; }
}

async function valid(target, manifest) {
  try {
    if ((await stat(target)).size !== manifest.bytes) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(target)) hash.update(chunk);
    return hash.digest("hex") === manifest.sha256;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function downloadOnce(manifest, partial, fetchImpl, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(manifest.url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new ExternalDownloadError(`request failed: ${describe(error)}`, { transient: true, cause: error });
  }
  if (!response.ok || !response.body) {
    // 5xx and 429 are the host's temporary trouble; other statuses will not fix themselves.
    throw new ExternalDownloadError(`HTTP ${response.status}`, { transient: response.status >= 500 || response.status === 429 });
  }
  let bytes = 0;
  const hash = createHash("sha256");
  const check = new Transform({ transform(chunk, encoding, callback) {
    bytes += chunk.length;
    if (bytes > manifest.bytes) return callback(new IntegrityError("Model exceeds the pinned size; refusing to install"));
    hash.update(chunk); callback(null, chunk);
  } });
  try {
    await pipeline(Readable.fromWeb(response.body), check, createWriteStream(partial, { flags: "wx" }));
  } catch (error) {
    if (error instanceof IntegrityError) throw error;
    throw new ExternalDownloadError(`transfer interrupted after ${bytes} of ${manifest.bytes} bytes: ${describe(error)}`, { transient: true, cause: error });
  }
  if (bytes !== manifest.bytes) {
    // A short body is an interrupted transfer, not a different model.
    throw new ExternalDownloadError(`transfer ended after ${bytes} of ${manifest.bytes} bytes`, { transient: true });
  }
  if (hash.digest("hex") !== manifest.sha256) throw new IntegrityError("Model SHA-256 does not match the pinned value; refusing to install");
}

/** Install the model into `directory` unless a verified copy is already there.
 * @param {{ directory: URL, manifest: { url: string, bytes: number, sha256: string }, fetchImpl?: typeof fetch,
 *   sleep?: (ms: number) => Promise<unknown>, delays?: number[], timeoutMs?: number, log?: (message: string) => void }} options */
export async function installRslModel({ directory, manifest, fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  delays = RETRY_DELAYS_MS, timeoutMs = 300000, log = console.log }) {
  const target = new URL("model.onnx", directory);
  if (await valid(target, manifest)) { log("Slovo pretrained model verified (1,000 sign classes)."); return { installed: false, attempts: 0 }; }
  await mkdir(directory, { recursive: true });
  const partial = new URL(`model.${process.pid}.partial`, directory);
  for (let attempt = 1; ; attempt++) {
    log(`Downloading official Slovo pretrained model (141 MB, once per checkout), attempt ${attempt} of ${delays.length + 1}…`);
    try {
      await downloadOnce(manifest, partial, fetchImpl, timeoutMs);
      await rename(partial, target);
      log("Slovo pretrained model installed and verified.");
      return { installed: true, attempts: attempt };
    } catch (error) {
      if (!(error instanceof ExternalDownloadError) || !error.transient || attempt > delays.length) throw error;
      log(`External download failed (${error.message}); retrying in ${delays[attempt - 1] / 1000} s.`);
      await sleep(delays[attempt - 1]);
    } finally {
      await rm(partial, { force: true });
    }
  }
}

function describe(error) {
  const cause = error?.cause;
  return [error?.message, cause?.code ?? cause?.message].filter(Boolean).join(": ") || String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = new URL("../public/models/rsl1000-slovo/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", directory), "utf8"));
  try {
    await installRslModel({ directory, manifest });
  } catch (error) {
    const external = error instanceof ExternalDownloadError;
    const host = new URL(manifest.url).host;
    const message = external
      ? `External download failure, not a code failure: the RSL model host ${host} did not deliver the model (${error.message}). Nothing was installed. Re-run when the host is reachable.`
      : error instanceof IntegrityError
        ? `RSL model integrity failure: ${error.message}. Expected ${manifest.bytes} bytes with SHA-256 ${manifest.sha256}. Nothing was installed.`
        : `RSL model install failed: ${describe(error)}`;
    console.error(message);
    if (process.env.GITHUB_ACTIONS) console.error(`::error title=${external ? "External download failed" : "RSL model install failed"}::${message}`);
    process.exit(external ? EXIT_EXTERNAL : error instanceof IntegrityError ? EXIT_INTEGRITY : 1);
  }
}
