import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csv, initial, leaderboard, player, reduce, score, streaks, timeLeft, validateBackup, ROUND_MS } from '../src/game.mjs';
import { SIGNS, signIds } from '../src/signs.mjs';

const at = 1_800_000_000_000;
const send = (s, a) => reduce(s, { now: at, ...a }, signIds);
const join = (s, id, name = 'Alex') => send(s, { type: 'register', id, name });
const play = (s, sign = signIds[0], id = 'r1') => send(s, { type: 'spin', personId: s.activeId, sign, id });
const key = (personId, challengeId = 'r1', run = 'run') => ({ personId, challengeId, run });
const start = (s, k) => send(s, { ...k, type: 'start' });
const result = (s, k, method = 'automatic', time = 1000) => send(s, { ...k, type: 'result', method, now: at + time });

test('wheel has exactly ten distinct supported entries with lessons', () => {
  assert.equal(SIGNS.length, 10);
  assert.equal(new Set(signIds).size, 10);
  assert.ok(SIGNS.every(s => s.word && s.cue));
});
test('a switch or pause at the deadline records a timeout exactly once', () => {
  let setup = join(join(initial(), 'second'), 'first');
  setup = start(play(setup), key('first'));
  const expired = send(setup, { type: 'select', personId: 'second', now: at + ROUND_MS });
  assert.equal(expired.people.find(p => p.id === 'first').results[0].method, 'timeout');
  assert.equal(expired.people.find(p => p.id === 'first').pending, null);
  const paused = send(setup, { type: 'pause', ...key('first'), now: at + ROUND_MS });
  assert.equal(player(paused).results.length, 1);
  assert.equal(result(paused, key('first'), 'timeout', ROUND_MS), paused);
});
test('perfect game, unique signs, all five awards and persisted streak', () => {
  let s = join(initial(), 'p1', 'Player One');
  for (const [index, sign] of signIds.slice(0, 5).entries()) {
    const round = 'r' + index;
    const k = key('p1', round);
    s = play(s, sign, round);
    assert.equal(s, play(s, signIds[5], 'repeat-click'));
    s = start(s, k);
    const expected = result(s, k, index % 2 === 0 ? 'automatic' : 'manual');
    assert.equal(expected, result(expected, k));
    if (index === 2) assert.deepEqual(streaks(player(expected)), { current: 3, best: 3 });
    s = expected;
    assert.equal(s, play(s, sign, 'already-played'));
  }
  assert.equal(score(player(s)), 50);
  assert.deepEqual(streaks(player(s)), { current: 5, best: 5 });
  assert.equal(s, play(s, signIds[6], 'over-limit'));
  assert.deepEqual(validateBackup(s, signIds).people, s.people);
});
test('five timeouts award zero and a deadline is authoritative', () => {
  let s = join(initial(), 'p1');
  for (const [index, sign] of signIds.slice(0, 5).entries()) {
    const id = 'r' + index;
    const k = key('p1', id);
    s = start(play(s, sign, id), k);
    assert.equal(s, result(s, k, 'timeout', ROUND_MS - 1));
    assert.equal(s, result(s, k, 'manual', ROUND_MS));
    s = result(s, k, 'timeout', ROUND_MS);
  }
  assert.equal(player(s).results.length, 5);
  assert.equal(score(player(s)), 0);
});
test('drop-in restores selection, time, nickname and stable identity', () => {
  let s = start(play(join(initial(), 'p1')), key('p1'));
  s = send(s, { type: 'register', name: 'Alex', id: 'p2', now: at + 6500 });
  assert.deepEqual(s.people.map(p => p.number), [1, 2]);
  assert.equal(s.people[0].pending.remaining, 13500);
  assert.equal(s, result(s, key('p1')));
  s = send(s, { type: 'rename', personId: 'p1', name: 'Alex K.' });
  s = send(s, { type: 'select', personId: 'p1' });
  assert.equal(player(s).name, 'Alex K.');
  s = start(s, key('p1', 'r1', 'new'));
  assert.equal(timeLeft(player(s).pending, at), 13500);
  assert.equal(s, result(s, key('p1')));
});
test('restart, skip, crash recovery and corrections respect ownership', () => {
  const k = key('p1');
  let s = start(play(join(initial(), 'p1')), k);
  s = send(s, { type: 'recover', ...k });
  assert.equal(player(s).pending.remaining, ROUND_MS);
  assert.equal(s, result(s, k));
  s = send(s, { ...k, type: 'skip' });
  assert.equal(player(s).results.length, 0);
  assert.equal(player(s).pending, null);
  s = start(play(s, signIds[0], 'r2'), key('p1', 'r2'));
  s = send(s, { type: 'restart', ...key('p1','r2') });
  assert.equal(player(s).pending.ready, false);
  s = start(s, key('p1','r2','new-run'));
  s = result(s, key('p1','r2','new-run'), 'manual');
  s = send(s, { type: 'correct', ...key('p1','r2'), award: false });
  assert.equal(score(player(s)), 0);
  assert.equal(player(s).results[0].originalMethod, 'manual');
});
test('competition ranks share ties, count all players and protect CSV formulas', () => {
  let s = initial();
  for (const [id, name, win] of [['p1','Array',true],['p2','Alex',true],['p3','=sum(1,2)',false]]) {
    s = join(s, id, name);
    s = start(play(s), key(id));
    s = result(s, key(id), win ? 'manual' : 'timeout', win ? 900 : 20001);
  }
  const rows = leaderboard(s.people);
  assert.deepEqual(rows.map(p => p.rank), [1,1,3]);
  assert.match(csv(rows), /"'\=sum\(1,2\)"/);
  const large = initial();
  large.people = Array.from({ length: 5000 }, (_, n) => ({ id: 'p' + n, name: 'Alex', number: n + 1, registeredAt: at, results: [], pending: null }));
  assert.ok(leaderboard(large.people).every(p => p.rank === 1));
  assert.equal(validateBackup(large, signIds).nextNumber, 5001);
});
test('backup validates identifiers, duplicate signs and malformed data', () => {
  let s = start(play(join(initial(), 'p1')), key('p1'));
  const saved = validateBackup(s, signIds);
  assert.equal(player(saved).pending.run, null);
  assert.equal(player(saved).pending.remaining, ROUND_MS);
  assert.throws(() => validateBackup({ version: 2 }, signIds));
  const duplicate = structuredClone(s);
  duplicate.people.push(duplicate.people[0]);
  assert.throws(() => validateBackup(duplicate, signIds), /Invalid participant/);
  s = result(s, key('p1'));
  s.people[0].pending = { ...s.people[0].results[0], id: 'another' };
  assert.throws(() => validateBackup(s, signIds), /Invalid challenge/);
});

