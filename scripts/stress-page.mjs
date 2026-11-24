import { leaderboard, player, ROUND_MS, score, timeLeft, validateBackup } from '../src/game.mjs';
import { openStore } from '../src/store.mjs';
import { signIds } from '../src/signs.mjs';

function require(value, message) {
  if (!value) throw new Error(message);
}
const first = openStore(signIds);
const second = openStore(signIds);
globalThis.exercise = async count => {
  const [store, rival] = await Promise.all([first, second]);
  let clock = Date.now();
  const measure = [];
  const scores = new Map();
  const begin = performance.now();
  async function write(action, expected = true, through = store) {
    const started = performance.now();
    const reply = await through.dispatch({ now: clock, ...action });
    measure.push(performance.now() - started);
    require(reply.changed === expected, 'Unexpected ' + action.type + ' at ' + clock);
    return reply.state;
  }

  for (let n = 0; n < count; n++) {
    const id = 'sim-' + n;
    scores.set(id, 0);
    await write({ type: 'register', id, name: 'Simulated group ' + n % 16 });
  }
  let staleRejected = 0;
  let resumed = 0;
  let timeouts = 0;
  let duplicates = 0;
  for (let round = 0; round < 5; round++) {
    for (let n = 0; n < count; n++) {
      const index = (n + round * 17) % count;
      const personId = 'sim-' + index;
      const challengeId = personId + '-round-' + round;
      const id = { personId, challengeId };
      const current = player((await store.read()).state);
      if (current.id !== personId) await write({ type: 'select', personId });
      await write({ type: 'spin', personId, id: challengeId, sign: signIds[(index + round) % 10] });
      let run = challengeId + '-first';
      const start = await write({ type: 'start', ...id, run });
      require(player(start).pending.deadline === clock + ROUND_MS, 'New attempt missed 20-second deadline');
      if (n % 4 === 0) {
        clock += 2425;
        const paused = await write({ type: 'select', personId: current.id === personId ? 'sim-' + ((n + 1) % count) : current.id });
        const waiting = paused.people.find(p => p.id === personId);
        require(timeLeft(waiting.pending, clock) === 17575, 'Switch lost exact remainder');
        await write({ type: 'result', ...id, run, method: 'automatic' }, false, rival);
        await write({ type: 'select', personId });
        const stale = run;
        run = challengeId + '-resume';
        const restart = await write({ type: 'start', ...id, run });
        require(player(restart).pending.deadline === clock + 17575, 'Resume deadline drifted');
        await write({ type: 'result', ...id, run: stale, method: 'manual' }, false, rival);
        staleRejected += 2;
        resumed++;
      }
      const active = { ...id, run };
      const record = player((await store.read()).state);
      const deadline = record.pending.deadline;
      const expire = (n + round * 2) % 5 === 0;
      if (expire) {
        await write({ type: 'result', ...active, method: 'timeout', now: deadline - 1 }, false);
        await write({ type: 'result', ...active, method: 'automatic', now: deadline }, false);
        clock = deadline;
        timeouts++;
      } else {
        clock += 1550;
        scores.set(personId, scores.get(personId) + 10);
      }
      const method = expire ? 'timeout' : (n % 2 ? 'manual' : 'automatic');
      const action = { type: 'result', ...active, method, now: clock };
      const settled = await Promise.all([store.dispatch(action), rival.dispatch(action)]);
      require(settled.filter(reply => reply.changed).length === 1, 'Duplicate award or missing result');
      duplicates++;
      clock += 11;
    }
  }
  const { state } = await store.read();
  require(state.people.length === count, 'Participant count mismatch');
  for (const person of state.people) {
    require(person.results.length === 5 && new Set(person.results.map(r => r.id)).size === 5, 'Unexpected completed results');
    require(score(person) === scores.get(person.id), 'Score mismatch for ' + person.id);
  }
  const ranked = leaderboard(state.people);
  ranked.forEach((person, index) => require(person.rank === 1 + ranked.findIndex(p => p.points === person.points) &&
    (!index || ranked[index - 1].points >= person.points), 'Leaderboard rank or tie failed'));
  const backup = JSON.parse(JSON.stringify(state));
  const validated = validateBackup(backup, signIds);
  const resets = await write({ type: 'reset' });
  require(resets.people.length === 0, 'Reset left records');
  const restored = await write({ type: 'restore', backup });
  require(JSON.stringify(restored.people) === JSON.stringify(validated.people), 'Restore changed participant data');
  const q = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    return Math.round(sorted[Math.ceil(sorted.length * p) - 1] * 100) / 100;
  };
  return {
    participants: count, games: count, rounds: count * 5, resumed, staleRejected, timeouts, duplicates,
    measuredTransactions: measure.length, elapsedMs: Math.round(performance.now() - begin),
    txP50Ms: q(measure, .50), txP95Ms: q(measure, .95),
    initialTxP95Ms: q(measure.slice(0, Math.floor(measure.length / 4)), .95),
    finalTxP95Ms: q(measure.slice(-Math.floor(measure.length / 4)), .95),
    totalPoints: ranked.reduce((sum, person) => sum + person.points, 0),
  };
};

