import { LABELS } from "./core.mjs";

const known = LABELS.slice(0, -1);
export const TRIALS = new Map(known.map(word => [word, { title: word, expected: [word] }]));
for (const [id, title, expected] of [
  ["repeat-yes", "YES twice, returning to rest", ["YES", "YES"]],
  ["visible-yes", "YES twice, keeping the hand visible", ["YES", "YES"]],
  ["repeat-please", "PLEASE twice", ["PLEASE", "PLEASE"]],
  ["yes-no", "YES then NO", ["YES", "NO"]],
  ["hello-thanks", "HELLO then THANK YOU", ["HELLO", "THANK YOU"]],
  ["cat", "CAT (unsupported)", []],
  ["fish", "FISH (unsupported)", []],
  ["other", "Another unsupported ASL sign", []],
  ["movement", "Ordinary movement or still hands", []],
]) TRIALS.set(id, { title, expected });

export function scoreTrial(expected, emitted, completed) {
  const allowance = new Map();
  for (const sign of expected) allowance.set(sign, (allowance.get(sign) ?? 0) + 1);
  let duplicateWords = 0;
  const seen = new Map();
  const withoutDuplicates = [];
  for (const sign of emitted) {
    const count = (seen.get(sign) ?? 0) + 1;
    seen.set(sign, count);
    if (count > Math.max(1, allowance.get(sign) ?? 0)) duplicateWords++;
    else withoutDuplicates.push(sign);
  }
  let outcome;
  if (!completed) outcome = "failed";
  else if (!expected.length) outcome = emitted.length ? "false accept" : "rejected";
  else if (!emitted.length) outcome = "abstained";
  else if (expected.length === withoutDuplicates.length && expected.every((word, index) => word === withoutDuplicates[index])) {
    outcome = duplicateWords ? "duplicate" : "correct";
  }
  else outcome = "incorrect";
  return { outcome, duplicateWords };
}

const choice = (value, allowed) => allowed.includes(value) ? value : null;
const metric = value => Number.isFinite(value) && value >= 0 ? Math.round(value * 10) / 10 : null;
const LIMIT = 200;
const WORD_LIMIT = 40;

export function bindWebcamTrials({ startCamera, finishCamera }) {
  const element = id => document.getElementById(id);
  const form = element("trial-form");
  const prompt = element("trial-prompt");
  const start = element("trial-start");
  const finish = element("trial-finish");
  const download = element("trial-download");
  const rows = element("trial-results");
  const status = element("trial-status");
  const choices = [...form.querySelectorAll("select")];
  const trials = [];
  let active;
  for (const [id, trial] of TRIALS) prompt.add(new Option(trial.title, id));

  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!active && trials.length < LIMIT) startCamera(new FormData(form));
  });
  finish.addEventListener("click", finishCamera);
  download.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ schema: "signrelay-webcam-trials-1", trials }, null, 2) + "\n"],
      { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "signrelay-webcam-trials.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  return {
    begin(fields) {
      const id = fields.get("prompt");
      if (!TRIALS.has(id) || active || trials.length >= LIMIT) return;
      active = { id, emitted: [], overflow: false, conditions: {
        distance: choice(fields.get("distance"), ["near", "usual", "far"]),
        light: choice(fields.get("light"), ["even", "dim", "backlit"]),
        speed: choice(fields.get("speed"), ["natural", "slow", "fast"]),
      } };
      choices.forEach(select => { select.disabled = true; });
      start.disabled = true;
      status.textContent = `Trial ${trials.length + 1} starting. Wait for Camera running.`;
    },
    ready() {
      if (!active) return;
      finish.disabled = false;
      status.textContent = `Perform ${TRIALS.get(active.id).title}. Wait two seconds, then choose Finish and score.`;
    },
    retry() {
      if (!active) return;
      finish.disabled = true;
      status.textContent = "Retrying on CPU. Wait for Camera running.";
    },
    observe(sign) {
      if (!active || !known.includes(sign)) return;
      if (active.emitted.length >= WORD_LIMIT) active.overflow = true;
      else active.emitted.push(sign);
    },
    end(completed, metrics = {}) {
      if (!active) return;
      const { id, conditions, emitted, overflow } = active;
      const { title, expected } = TRIALS.get(id);
      const result = { number: trials.length + 1, prompt: id, conditions, expected, emitted,
        ...scoreTrial(expected, emitted, completed && !overflow), overflow,
        frames: metric(metrics.frames), usableHands: metric(metrics.hands),
        analyzedFps: metric(metrics.fps), startupMs: metric(metrics.startup) };
      trials.push(result);
      active = null;
      choices.forEach(select => { select.disabled = false; });
      const row = document.createElement("li");
      row.textContent = `${title} · ${result.outcome} · ${emitted.join(" → ") || "no suggestions"}`;
      rows.append(row);
      download.disabled = false;
      finish.disabled = true;
      start.disabled = trials.length >= LIMIT;
      status.textContent = start.disabled ? "Session full. Download the log before reloading." : `Trial ${result.number} scored ${result.outcome}.`;
    },
  };
}
