import { Camera } from './camera.mjs';
import { csv, initial, leaderboard, MAX_ROUNDS, player, ROUND_MS, score, streaks, successful, timeLeft, validateBackup } from './game.mjs';
import { icon } from './icons.mjs';
import { checkOffline } from './offline.mjs';
import { SIGNS, signIds, signById } from './signs.mjs';
import { Audio, confetti, Wheel } from './spectacle.mjs';
import { openStore } from './store.mjs';
import { $, escapeHtml, renderBoard, renderHost, renderPeople, renderStage, setupIcons, threshold } from './view.mjs';

let state = initial();
let store;
let operator = false;
let myRun;
let starting = false;
let spin;
let resultView;
let problem = '';
let finishing = false;
let toastTimer;
let renameId;
let idle = false;
let offline = 'Checking cache…';
let devices = [];
let observedHands = -1;
let tracking;
let evidence;
let challengeTick;
let nextTone;
let recoveryKey;
let recoveryInProgress = false;
const logs = [];

const audio = new Audio(() => state.settings);
const wheel = new Wheel($('wheel'), SIGNS, audio);
const camera = new Camera($('camera'), $('overlay'), cameraEvent, () => state.settings);
const uid = () => crypto.randomUUID();
const active = () => player(state);
const attemptKey = p => ({ personId: p?.id, challengeId: p?.pending?.id, run: p?.pending?.run });
const say = (element, value) => { if (element.textContent !== value) element.textContent = value; };
const hasDialog = () => !!document.querySelector('dialog[open]');

function log(message) {
  logs.push(new Date().toLocaleTimeString() + ' ' + message);
  if (logs.length > 25) logs.shift();
}
function toast(message) {
  clearTimeout(toastTimer);
  say($('toast'), message);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4800);
}
function diagnostics() {
  if (!$('host').open) return;
  const stats = evidence ? '\nTarget evidence ' + evidence.score.toFixed(3) + ' · p ' + evidence.p.toFixed(3) +
    ' · cosine ' + evidence.cosine.toFixed(3) + ' · unknown ' + evidence.unknown.toFixed(3) + ' · ' + evidence.ms + ' ms' : '';
  const cadence = tracking?.fps ? '\nTracking  ' + tracking.fps + ' analyzed frames/s · ' + tracking.ms + ' ms latest' : '';
  say($('diagnostics'), 'Model  ' + camera.model + '\nCamera  ' + camera.status + '\nOffline  ' + offline +
    '\nThreshold  ' + threshold(state.settings).toFixed(2) + stats + cadence + '\n\n' + logs.slice(-12).reverse().join('\n'));
}

function kind(p) {
  if (!p || spin) return 'wheel';
  if (p.results.length === MAX_ROUNDS) return 'completion';
  if (resultView?.personId === p.id && !p.pending) return 'result';
  if (p.pending) return p.pending.ready ? 'challenge' : 'teaching';
  return 'wheel';
}
function render() {
  const p = active();
  const stage = kind(p);
  const before = document.body.dataset.stage;
  const ui = { spinning: !!spin, starting, problem, operator, result: resultView?.result, devices };
  renderStage(stage, p, state, ui);
  const heading = $('wheel-copy').querySelector('h1');
  if (heading) heading.id = 'wheel-title';
  $('wheel').setAttribute('aria-label', 'Wheel: ' + SIGNS.map(s => s.word).join(', '));
  wheel.setUsed(p?.results.map(r => r.sign) ?? []);
  if (stage === 'wheel' && !p && !idle) { idle = true; wheel.idle(); }
  if ((stage !== 'wheel' || p) && idle) { idle = false; wheel.stop(); }
  const muteButton = document.querySelector('[data-action="mute"]');
  muteButton.innerHTML = icon(state.settings.muted ? 'mute' : 'sound');
  muteButton.setAttribute('aria-label', state.settings.muted ? 'Unmute sound' : 'Mute sound');
  muteButton.title = muteButton.getAttribute('aria-label');
  muteButton.setAttribute('aria-pressed', String(state.settings.muted));
  if ($('players').open) renderPeople(state);
  if ($('host').open) renderHost(state, ui);
  diagnostics();
  if (stage === 'challenge') drawClock();
  if (stage !== before && !hasDialog()) {
    const title = $(stage + '-stage').querySelector('h1');
    if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
  }
}

function sync(newState) {
  if (newState.revision < state.revision) return;
  const old = active();
  state = newState;
  const p = active();
  if (old?.id !== p?.id || old?.pending?.id !== p?.pending?.id) {
    observedHands = -1;
    tracking = undefined;
    evidence = undefined;
  }
  if (spin && (spin.personId !== p?.id || spin.challengeId !== p?.pending?.id)) {
    // A newly bound spin has not reached the database yet.
    if (!spin.saving || spin.personId !== p?.id) { wheel.stop(); spin = null; }
  }
  if (resultView?.personId !== p?.id) resultView = null;
  if (myRun && p?.pending?.run !== myRun) {
    camera.stopCamera();
    myRun = null;
    observedHands = -1;
    tracking = undefined;
    evidence = undefined;
  }
  if (old?.id !== p?.id) {
    starting = false;
    problem = '';
    camera.stopCamera();
  }
  renderBoard(state);
  render();
}

async function dispatch(action) {
  if (!operator) {
    toast('GameShow controls are active in another tab. Close that tab and reload here.');
    return false;
  }
  if (!store) { toast('Game storage is unavailable. Reload to retry.'); return false; }
  try {
    const response = await store.dispatch({ ...action, now: action.now ?? Date.now() });
    sync(response.state);
    return response.changed;
  } catch (error) {
    log('Storage: ' + error.message);
    toast('Could not save. The last saved score is still shown.');
    return false;
  }
}

function drawClock() {
  const p = active();
  if (!p?.pending?.ready) return;
  const round = p.pending;
  const remaining = timeLeft(round);
  const seconds = Math.ceil(remaining / 1000);
  say($('seconds'), String(seconds));
  $('countdown').classList.toggle('low', seconds <= 5);
  $('time-fill').style.transform = 'scaleX(' + (remaining / ROUND_MS).toFixed(4) + ')';
  if (!round.deadline) {
    say($('feedback'), problem ? 'The host can retry or switch to host judging.' : 'Ready to pick up where you left off?');
    return;
  }
  if (myRun !== round.run || !operator) return;
  if (seconds && seconds <= 5 && seconds !== nextTone) { nextTone = seconds; audio.play('final'); }
  if (remaining <= 0 && !finishing) void settle('timeout', myRun);
  const feedback = state.settings.manual ? 'Sign for your host before time runs out.' :
    observedHands <= 0 ? 'Show your hands inside the frame.' :
    evidence?.score >= threshold(state.settings) * .76 ? 'You’re getting closer!' : 'Take your time and try the movement again.';
  say($('feedback'), feedback);
}
function startClock() {
  clearInterval(challengeTick);
  nextTone = undefined;
  drawClock();
  challengeTick = setInterval(() => {
    if (!active()?.pending?.deadline && !starting) { clearInterval(challengeTick); challengeTick = undefined; }
    drawClock();
  }, 80);
}
function cameraEvent(type, value) {
  if (type === 'match') { void settle('automatic', value); return; }
  if (type === 'fault') { void recoverCamera(value); return; }
  if (type === 'hands') { tracking = value; observedHands = value.count; }
  if (type === 'evidence') evidence = value;
  if (type === 'model' || type === 'camera') log(value);
  diagnostics();
}
async function refreshDevices() {
  try { devices = (await navigator.mediaDevices?.enumerateDevices() ?? []).filter(device => device.kind === 'videoinput'); }
  catch { devices = []; }
}
async function refreshOffline() {
  try {
    const data = await checkOffline();
    offline = data.installing ? 'Installing assets…' : data.missing.length ?
      data.missing.length + ' required assets missing' : 'Ready · ' + data.count + ' verified assets · ' + data.version;
  } catch (error) { offline = error.message; }
  diagnostics();
}
async function beginRound() {
  const p = active();
  if (starting || !p?.pending || p.pending.deadline || !operator) return;
  starting = true;
  problem = '';
  const key = attemptKey(p);
  const run = uid();
  const { manual, camera: device } = state.settings;
  render();
  try {
    if (!manual) {
      const result = await Promise.allSettled([camera.warm(), camera.open(device)]);
      if (result[0].status === 'rejected') throw new Error('Recognition is unavailable. Retry or use host judging. ' + result[0].reason.message);
      if (result[1].status === 'rejected') throw result[1].reason;
      if (!result[1].value) return;
    }
    const current = active();
    if (current?.id !== key.personId || current?.pending?.id !== key.challengeId ||
        state.settings.manual !== manual || state.settings.camera !== device) return;
    myRun = run;
    starting = false;
    const committed = await dispatch({ ...key, type: 'start', run });
    if (!committed) { myRun = null; camera.stopCamera(); return; }
    if (!manual) camera.play(run, current.pending.sign, threshold(state.settings));
    audio.play('start');
    startClock();
    void refreshDevices();
  } catch (error) {
    if (active()?.pending?.id === key.challengeId) {
      problem = error.message;
      camera.stopCamera();
      log(problem);
    }
  } finally {
    starting = false;
    render();
  }
}
async function recoverCamera({ message, workers }) {
  const p = active();
  const key = attemptKey(p);
  log(message);
  if (!key.run || key.run !== myRun || recoveryInProgress) { diagnostics(); return; }
  recoveryInProgress = true;
  problem = message + ' Your clock is paused.';
  await dispatch({ ...key, type: 'pause' });
  if (p.pending.id !== recoveryKey) {
    recoveryKey = p.pending.id;
    if (workers) void camera.warm().catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 350));
    if (active()?.pending?.id === p.pending.id && !document.hidden && !hasDialog()) await beginRound();
  }
  recoveryInProgress = false;
  render();
}
async function leaveRun(type) {
  const p = active();
  if (!p?.pending) return;
  const key = attemptKey(p);
  problem = '';
  camera.stopCamera();
  await dispatch({ type, ...key });
}
async function settle(method, run) {
  const p = active();
  if (!p?.pending?.deadline || p.pending.run !== run || myRun !== run || finishing) return;
  const now = Date.now();
  if (method !== 'timeout' && now >= p.pending.deadline) return;
  finishing = true;
  const pending = p.pending;
  const priorScore = score(p);
  const changed = await dispatch({ ...attemptKey(p), type: 'result', method, now });
  finishing = false;
  const current = active();
  if (!changed || p.id !== current?.id) return;
  const result = current.results.find(item => item.id === pending.id);
  resultView = { personId: p.id, result };
  problem = '';
  render();
  const correct = successful(result);
  if (correct) {
    const scoreText = $('player-card').querySelector('.board-score');
    if (scoreText && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const began = performance.now();
      const grow = now => {
        if (!scoreText.isConnected) return;
        const t = Math.min(1, (now - began) / 470);
        scoreText.firstChild.nodeValue = String(Math.round(priorScore + (score(current) - priorScore) * t));
        if (t < 1) requestAnimationFrame(grow);
      };
      requestAnimationFrame(grow);
    }
    const streak = streaks(current).current;
    const perfect = score(current) === 50;
    audio.play(perfect ? 'perfect' : streak >= 3 ? 'streak' : 'win');
    confetti($('confetti'), streak >= 3 ? 2 : 1);
  } else audio.play('timeout');
}
async function roll() {
  const p = active();
  if (!operator || spin || !p || p.pending || p.results.length >= MAX_ROUNDS) return;
  const options = SIGNS.filter(sign => !p.results.some(result => result.sign === sign.id));
  const sign = options[Math.floor(Math.random() * options.length)].id;
  const revision = { personId: p.id, challengeId: uid(), saving: true };
  spin = revision;
  render();
  const committed = await dispatch({ type: 'spin', personId: p.id, sign, id: revision.challengeId });
  revision.saving = false;
  if (spin !== revision) return;
  if (committed) {
    const finished = await wheel.spin(sign);
    if (spin !== revision) return;
    if (finished) audio.play('select');
  }
  spin = null;
  render();
}

function show(name) {
  const dialog = $(name);
  if (!dialog.open) dialog.showModal();
}
function close(name) { if ($(name).open) $(name).close(); }
function confirmChange(message, label, callback) {
  $('confirm-message').textContent = message;
  $('confirm-yes').textContent = label;
  const dialog = $('confirm');
  dialog.returnValue = 'cancel';
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'yes') void callback();
  }, { once: true });
  show('confirm');
}
function findPeople() {
  close('host');
  show('players');
  renderPeople(state);
  $('name').focus();
}
function fileDownload(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function closePlayerPanel() {
  close('players');
  if (document.body.dataset.stage === 'teaching') $('lesson-video').play().catch(() => {});
}

const actions = {
  spin: roll,
  start: beginRound,
  next() { resultView = null; render(); },
  'open-players': findPeople,
  async host() {
    show('host');
    render();
    await refreshDevices();
    render();
    void refreshOffline();
  },
  leaderboard() { show('leader-dialog'); renderBoard(state); },
  async 'leader-fullscreen'() {
    const board = $('leader-dialog');
    try {
      if (board.classList.contains('full-display')) {
        board.classList.remove('full-display');
        if (board.dataset.enteredFullscreen && document.fullscreenElement) await document.exitFullscreen();
        delete board.dataset.enteredFullscreen;
      } else {
        board.classList.add('full-display');
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
          board.dataset.enteredFullscreen = 'true';
        }
      }
    } catch { toast('Fullscreen leaderboard is unavailable in this browser.'); }
  },
  async mute() { await dispatch({ type: 'settings', patch: { muted: !state.settings.muted } }); },
  async fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { toast('This browser could not enter fullscreen. Use its fullscreen menu.'); }
  },
  async attract() {
    if (spin) { wheel.stop(); spin = null; }
    resultView = null;
    close('host');
    await dispatch({ type: 'attract' });
  },
  async select(control) {
    if (!operator) { toast('Select players in the active host tab.'); return; }
    await dispatch({ type: 'select', personId: control.dataset.person });
    closePlayerPanel();
  },
  rename(control) {
    const p = state.people.find(person => person.id === control.dataset.person);
    if (!p) return;
    renameId = p.id;
    $('new-name').value = p.name;
    show('rename');
    $('new-name').select();
  },
  remove(control) {
    const p = state.people.find(person => person.id === control.dataset.person);
    if (p) confirmChange('Remove ' + p.name + ' and their scores?', 'Remove player',
      () => dispatch({ type: 'remove', personId: p.id }));
  },
  pause: () => leaveRun('pause'),
  manual() {
    const p = active();
    if (p?.pending?.deadline) void settle('manual', p.pending.run);
  },
  restart() {
    confirmChange('Restart this round with a fresh 20 seconds?', 'Restart round', () => leaveRun('restart'));
  },
  skip() {
    confirmChange('Return this sign to the wheel and keep the player’s round?', 'Skip round', () => leaveRun('skip'));
  },
  correct(control) {
    const p = active();
    const result = p?.results.find(item => item.id === control.dataset.challenge);
    if (!result) return;
    const award = !successful(result);
    confirmChange('Set ' + signById[result.sign].word + ' to ' + (award ? 10 : 0) + ' points for ' + p.name + '?', 'Save correction', async () => {
      await dispatch({ type: 'correct', personId: p.id, challengeId: result.id, award });
      if (resultView?.result.id === result.id) { resultView.result = active().results.find(item => item.id === result.id); render(); }
    });
  },
  async retry() {
    if (!operator) return;
    if (active()?.pending?.deadline) await leaveRun('pause');
    problem = '';
    await camera.warm().catch(error => { problem = error.message; });
    if (active()?.pending) await beginRound();
    else toast(problem || 'Recognition models are ready.');
  },
  replay() {
    const video = $('lesson-video');
    video.currentTime = 0;
    video.play().catch(() => {});
  },
  async offline() { await refreshOffline(); toast(offline); },
  async persist() {
    try {
      const granted = await navigator.storage.persist();
      toast(granted ? 'Durable storage granted.' : 'Browser declined durable storage.');
    } catch { toast('Durable storage is unavailable in this browser.'); }
  },
  backup() {
    fileDownload('signrelay-gameshow-' + new Date().toISOString().slice(0, 10) + '.backup.json',
      JSON.stringify(state, null, 2), 'application/json');
  },
  csv() { fileDownload('signrelay-gameshow-leaderboard.csv', '\uFEFF' + csv(leaderboard(state.people)), 'text/csv;charset=utf-8'); },
  import() { $('backup-file').click(); },
  reset() {
    confirmChange('Delete every player and score from this browser? Export a backup first if you need them.', 'Reset session', async () => {
      if (await dispatch({ type: 'reset' })) close('host');
    });
  },
};

setupIcons();
document.addEventListener('click', event => {
  const control = event.target.closest('button');
  if (!control) return;
  audio.unlock();
  if (control.dataset.close) { close(control.dataset.close); return; }
  if (actions[control.dataset.action]) Promise.resolve(actions[control.dataset.action](control)).catch(error => {
    log(error.message); toast(error.message);
  });
});
document.addEventListener('keydown', event => {
  if (event.altKey && event.key.toLowerCase() === 'h') {
    event.preventDefault();
    if ($('host').open) close('host'); else if (!hasDialog()) void actions.host();
  }
});
$('search').addEventListener('input', () => renderPeople(state));
$('register').addEventListener('submit', async event => {
  event.preventDefault();
  audio.unlock();
  if (await dispatch({ type: 'register', id: uid(), name: $('name').value })) {
    $('name').value = '';
    $('search').value = '';
    closePlayerPanel();
  }
});
$('rename-form').addEventListener('submit', async event => {
  event.preventDefault();
  await dispatch({ type: 'rename', personId: renameId, name: $('new-name').value });
  close('rename');
});
$('players').addEventListener('close', () => { if (document.body.dataset.stage === 'teaching') $('lesson-video').play().catch(() => {}); });
$('leader-dialog').addEventListener('close', () => {
  const board = $('leader-dialog');
  if (board.dataset.enteredFullscreen && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  board.classList.remove('full-display');
  delete board.dataset.enteredFullscreen;
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    $('leader-dialog').classList.remove('full-display');
    delete $('leader-dialog').dataset.enteredFullscreen;
  }
});
$('reference-video').closest('details').addEventListener('toggle', event => {
  const media = $('reference-video');
  if (event.target.open) media.play().catch(() => {}); else media.pause();
});
$('backup-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    if (file.size > 14_000_000) throw new Error('This is not a GameShow backup.');
    const backup = validateBackup(JSON.parse(await file.text()), signIds);
    confirmChange('Replace this session with the backup containing ' + backup.people.length + ' players?', 'Restore backup',
      () => dispatch({ type: 'restore', backup }));
  } catch (error) { toast(error.message); }
});
$('host').addEventListener('change', async event => {
  const { target } = event;
  const key = target.dataset.setting;
  if (!key) return;
  const value = target.type === 'checkbox' ? target.checked : target.type === 'range' ? Number(target.value) / 100 : target.value;
  if (key === 'camera' || key === 'manual') {
    if (active()?.pending?.deadline) await leaveRun('pause');
    else { problem = ''; camera.stopCamera(); }
  }
  await dispatch({ type: 'settings', patch: { [key]: value } });
  camera.setThreshold(threshold(state.settings));
});
$('host').addEventListener('input', event => {
  if (event.target.id === 'volume') say($('volume-value'), event.target.value + '%');
  if (event.target.id === 'custom') say($('custom-value'), event.target.value);
});
navigator.mediaDevices?.addEventListener('devicechange', () => { if ($('host').open) void refreshDevices().then(render); });
navigator.serviceWorker?.addEventListener('controllerchange', () => { void refreshOffline(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && myRun && active()?.pending?.run === myRun) void leaveRun('pause');
});
window.addEventListener('pagehide', () => { camera.stopCamera(); });

async function boot() {
  store = await openStore(signIds);
  if (navigator.locks) {
    operator = await new Promise(resolve => {
      navigator.locks.request('signrelay-gameshow-operator', { ifAvailable: true }, lock => {
        resolve(!!lock);
        if (lock) return new Promise(() => {});
      }).catch(() => resolve(true));
    });
  } else operator = true;
  const data = await store.read();
  sync(data.state);
  store.subscribe(() => { void store.read().then(data => sync(data.state)).catch(error => log(error.message)); });
  const pending = active()?.pending;
  if (pending?.deadline) {
    if (operator) await dispatch({ type: 'recover', ...attemptKey(active()) });
    else startClock();
  }
  if (operator) void camera.warm().catch(() => {});
  void refreshOffline();
  fetch('./lesson-credits.json').then(response => response.ok ? response.json() : []).then(clips => {
    $('credits').innerHTML = '<p>PopSign ASL v2.1, Georgia Tech and the Deaf Professional Arts Network. Clips resized and muted.</p><ul>' +
      clips.map(clip => '<li>' + escapeHtml(clip.word) + ' · <a rel="noreferrer" target="_blank" href="' + escapeHtml(clip.source) +
        '">Source recording</a> · <a rel="noreferrer" target="_blank" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></li>').join('') + '</ul>';
  }).catch(() => {});
}
boot().catch(error => {
  renderBoard(state);
  render();
  toast('GameShow could not open its saved session. ' + error.message);
});

