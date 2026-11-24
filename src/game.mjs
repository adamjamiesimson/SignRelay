export const MAX_ROUNDS = 5;
export const ROUND_MS = 20_000;
export const POINTS = 10;
export const MODES = Object.freeze({ relaxed: 0.60, standard: 0.69, strict: 0.79 });
export const DEFAULTS = Object.freeze({ mode: 'relaxed', custom: 0.60, volume: 0.48, muted: false, overlay: true, camera: '', manual: false });
export const initial = () => ({ version: 1, revision: 0, nextNumber: 1, activeId: null, settings: { ...DEFAULTS }, people: [] });
export const cleanName = s => String(s ?? '').trim().replace(/\s+/gu, ' ').slice(0, 36);
export const player = state => state.people.find(p => p.id === state.activeId);
export const timeLeft = (pending, now = Date.now()) => Math.min(ROUND_MS, Math.max(0, pending?.deadline ? pending.deadline - now : pending?.remaining ?? ROUND_MS));
export const successful = result => result.method !== 'timeout' && result.method !== 'corrected-zero';
export const score = person => person.results.filter(successful).length * POINTS;

export function streaks(person) {
  let current = 0;
  let best = 0;
  for (const result of person.results) {
    current = successful(result) ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return { current, best };
}

export function leaderboard(people) {
  const rows = people.map(p => ({ ...p, points: score(p), streak: streaks(p).current }));
  rows.sort((a, b) => b.points - a.points || a.number - b.number);
  let rank = 0;
  return rows.map((row, index) => {
    if (!index || row.points !== rows[index - 1].points) rank = index + 1;
    return { ...row, rank };
  });
}

export function validateSettings(input) {
  const settings = { ...DEFAULTS };
  if (input && typeof input === 'object') {
    if (Object.hasOwn(MODES, input.mode) || input.mode === 'custom') settings.mode = input.mode;
    if (Number.isFinite(input.custom)) settings.custom = Math.min(0.95, Math.max(0.40, input.custom));
    if (Number.isFinite(input.volume)) settings.volume = Math.min(1, Math.max(0, input.volume));
    if (typeof input.camera === 'string') settings.camera = input.camera.slice(0, 512);
    for (const key of ['overlay', 'muted', 'manual']) if (typeof input[key] === 'boolean') settings[key] = input[key];
  }
  return settings;
}

export function freezeAttempt(p, now) {
  if (!p?.pending?.deadline) return;
  p.pending.remaining = timeLeft(p.pending, now);
  p.pending.deadline = null;
  p.pending.run = null;
}

function update(state, action, supported) {
  const p = player(state);
  const now = action.now ?? Date.now();
  const pending = p?.pending;
  const target = state.people.find(person => person.id === action.personId);
  const ownsAttempt = !!pending && p.id === action.personId && pending.id === action.challengeId;
  const ownsRun = ownsAttempt && pending.run === action.run && !!pending.deadline && !!action.run;
  switch (action.type) {
    case 'register': {
      const name = cleanName(action.name);
      if (!name || !action.id || state.people.some(person => person.id === action.id)) return false;
      freezeAttempt(p, now);
      state.people.push({ id: action.id, number: state.nextNumber++, name, registeredAt: now, results: [], pending: null });
      state.activeId = action.id;
      return true;
    }
    case 'select':
      if (!target || target === p) return false;
      freezeAttempt(p, now);
      state.activeId = target.id;
      return true;
    case 'attract':
      if (!p) return false;
      freezeAttempt(p, now);
      state.activeId = null;
      return true;
    case 'rename': {
      const name = cleanName(action.name);
      if (!target || !name || target.name === name) return false;
      target.name = name;
      return true;
    }
    case 'remove':
      if (!target) return false;
      state.people = state.people.filter(person => person !== target);
      if (p === target) state.activeId = null;
      return true;
    case 'spin':
      if (!p || p.id !== action.personId || pending || p.results.length >= MAX_ROUNDS ||
        !supported.includes(action.sign) || p.results.some(result => result.sign === action.sign) || !action.id) return false;
      p.pending = { id: action.id, sign: action.sign, selectedAt: now, ready: false, remaining: ROUND_MS, deadline: null, run: null };
      return true;
    case 'start':
      if (!ownsAttempt || pending.deadline || !action.run) return false;
      pending.ready = true;
      pending.remaining ||= ROUND_MS;
      pending.deadline = now + pending.remaining;
      pending.run = action.run;
      return true;
    case 'pause':
      if (!ownsRun) return false;
      freezeAttempt(p, now);
      return true;
    case 'recover':
      if (!ownsRun) return false;
      pending.deadline = null;
      pending.run = null;
      pending.remaining = ROUND_MS;
      return true;
    case 'restart':
      if (!ownsAttempt) return false;
      pending.deadline = null;
      pending.run = null;
      pending.remaining = ROUND_MS;
      pending.ready = false;
      return true;
    case 'skip':
      if (!ownsAttempt) return false;
      p.pending = null;
      return true;
    case 'result': {
      if (!ownsRun || p.results.length >= MAX_ROUNDS || p.results.some(result => result.id === pending.id)) return false;
      if (!['automatic', 'manual', 'timeout'].includes(action.method)) return false;
      if ((action.method === 'timeout') !== (now >= pending.deadline)) return false;
      p.results.push({ id: pending.id, sign: pending.sign, method: action.method, selectedAt: pending.selectedAt, completedAt: now });
      p.pending = null;
      return true;
    }
    case 'correct': {
      const result = target?.results.find(r => r.id === action.challengeId);
      if (!result || successful(result) === action.award) return false;
      result.originalMethod ??= result.method;
      result.method = action.award ? 'corrected-correct' : 'corrected-zero';
      result.correctedAt = now;
      return true;
    }
    case 'settings':
      state.settings = validateSettings({ ...state.settings, ...action.patch });
      return true;
    case 'reset':
      Object.assign(state, initial(), { revision: state.revision, settings: state.settings });
      return true;
    case 'restore':
      Object.assign(state, validateBackup(action.backup, supported), { revision: state.revision });
      return true;
    default:
      return false;
  }
}

export function reduce(base, action, supported) {
  const next = structuredClone(base);
  if (!update(next, action, supported)) return base;
  next.revision++;
  return next;
}

export function validateBackup(input, supported) {
  if (input?.version !== 1 || !Array.isArray(input.people) || input.people.length > 20000) throw new Error('Invalid GameShow backup.');
  const result = initial();
  result.settings = validateSettings(input.settings);
  const ids = new Set();
  const numbers = new Set();
  const date = v => Number.isSafeInteger(v) && v >= 0;
  const id = v => typeof v === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(v);
  const methods = ['automatic', 'manual', 'timeout', 'corrected-correct', 'corrected-zero'];
  for (const p of input.people) {
    if (!p || !id(p.id) || ids.has(p.id) || !Number.isSafeInteger(p.number) || p.number < 1 ||
      p.number >= Number.MAX_SAFE_INTEGER - 20001 || numbers.has(p.number) ||
      typeof p.name !== 'string' || !cleanName(p.name) || !date(p.registeredAt) ||
      !Array.isArray(p.results) || p.results.length > MAX_ROUNDS) throw new Error('Invalid participant record.');
    ids.add(p.id);
    numbers.add(p.number);
    const person = { id: p.id, number: p.number, name: cleanName(p.name), registeredAt: p.registeredAt, results: [], pending: null };
    const signs = new Set();
    const challengeIds = new Set();
    function validChallenge(r) {
      if (!r || !id(r.id) || challengeIds.has(r.id) || !supported.includes(r.sign) ||
        signs.has(r.sign) || !date(r.selectedAt)) throw new Error('Invalid challenge record.');
      signs.add(r.sign);
      challengeIds.add(r.id);
    }
    for (const r of p.results) {
      validChallenge(r);
      if (!methods.includes(r.method) || !date(r.completedAt)) throw new Error('Invalid challenge result.');
      const item = { id: r.id, sign: r.sign, method: r.method, selectedAt: r.selectedAt, completedAt: r.completedAt };
      if (methods.slice(0, 3).includes(r.originalMethod) && date(r.correctedAt)) {
        item.originalMethod = r.originalMethod;
        item.correctedAt = r.correctedAt;
      }
      person.results.push(item);
    }
    if (p.pending) {
      validChallenge(p.pending);
      if (person.results.length === MAX_ROUNDS) throw new Error('Invalid pending challenge.');
      const remaining = p.pending.deadline ? ROUND_MS : p.pending.remaining;
      person.pending = { id: p.pending.id, sign: p.pending.sign, selectedAt: p.pending.selectedAt,
        ready: p.pending.ready === true, remaining: Number.isFinite(remaining) ? Math.min(ROUND_MS, Math.max(0, remaining)) : ROUND_MS, deadline: null, run: null };
    }
    result.people.push(person);
    result.nextNumber = Math.max(result.nextNumber, p.number + 1);
  }
  result.activeId = ids.has(input.activeId) ? input.activeId : null;
  return result;
}

export function csv(rows) {
  const quote = x => {
    const raw = String(x);
    const value = /^[\s]*[=+\-@\t\r\n]/u.test(raw) || /^[\t\r\n]/.test(raw) ? "'" + raw : raw;
    return '"' + value.replaceAll('"', '""') + '"';
  };
  return ['Rank,Name,Player ID,Score,Completed,Best streak', ...rows.map(p =>
    [p.rank, p.name, p.number, p.points, p.results.length, streaks(p).best].map(quote).join(','))].join('\r\n') + '\r\n';
}

