import { leaderboard, MAX_ROUNDS, MODES, player, score, streaks, successful } from './game.mjs';
import { signById } from './signs.mjs';
import { icon } from './icons.mjs';

export const $ = name => document.getElementById(name);
export const escapeHtml = value => String(value).replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export const playerNumber = p => '#' + String(p.number).padStart(3, '0');
const button = (action, label, kind = '') => '<button data-action="' + action + '" class="' + kind + '">' + label + '</button>';
const buy = (action, label) => button(action, label, 'primary');
const podium = (current, p) => '<li class="board-row' + (current === p.id ? ' active' : '') + (p.points > 0 && p.rank === 1 ? ' best' : '') +
  '" data-row="' + p.id + '"' + (current === p.id ? ' aria-current="true"' : '') + '><span class="rank">' + p.rank +
  '</span><div><div class="board-name">' + escapeHtml(p.name) + '</div><div class="board-meta">' + playerNumber(p) +
  ' · ' + p.results.length + '/5 rounds' + (p.streak >= 3 ? ' · ' + p.streak + '-sign streak' : '') +
  '</div></div><span class="board-score">' + p.points + '<small>/50</small></span></li>';

export function setupIcons() {
  for (const [action, mark] of Object.entries({ mute:'sound', fullscreen:'fullscreen', host:'gear', leaderboard:'board', 'leader-fullscreen':'fullscreen', replay:'replay' })) {
    document.querySelectorAll('button[data-action="' + action + '"].icon-button,button[data-action="' + action + '"].media-control')
      .forEach(control => { control.innerHTML = icon(mark); });
  }
  document.querySelectorAll('button[data-close].icon-button').forEach(control => { control.innerHTML = icon('close'); });
}

export function renderBoard(state) {
  const rows = leaderboard(state.people);
  for (const id of ['board-list', 'full-board']) {
    const list = $(id);
    if (id === 'full-board' && !$('leader-dialog').open) continue;
    const previous = new Map([...list.querySelectorAll('[data-row]')].slice(0, 50).map(row => [row.dataset.row, row.offsetTop]));
    const scroll = list.scrollTop;
    list.innerHTML = rows.length ? rows.map(p => podium(state.activeId, p)).join('') :
      '<li class="board-empty">Scores appear when players join.</li>';
    list.scrollTop = scroll;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      [...list.querySelectorAll('[data-row]')].slice(0, 50).forEach(row => {
        const previousTop = previous.get(row.dataset.row);
        if (previousTop !== undefined && previousTop !== row.offsetTop) row.animate(
          [{ transform: 'translateY(' + (previousTop - row.offsetTop) + 'px)' }, { transform: 'none' }], { duration: 330, easing: 'ease-out' });
      });
    }
  }
  $('board-count').textContent = rows.length + (rows.length === 1 ? ' player' : ' players');
  const p = player(state);
  const count = p?.results.length ?? 0;
  const dots = Array.from({ length: MAX_ROUNDS }, (_, i) => {
    const kind = i < count ? successful(p.results[i]) ? 'won' : 'missed' : i === count && p ? 'next' : '';
    return '<i class="' + kind + '"></i>';
  }).join('');
  $('player-card').innerHTML = p
    ? '<div class="player-card-head"><div><p class="eyebrow">CURRENT PLAYER</p><h2>' +
      escapeHtml(p.name) + ' <span>' + playerNumber(p) + '</span></h2></div><span class="board-score">' + score(p) +
      '<small>/50</small></span></div><div class="round-dots" aria-label="' + count + ' of 5 rounds complete">' + dots + '</div>'
    : '<div class="player-card-head"><div><p class="eyebrow">CURRENT PLAYER</p><h2>Ready when you are</h2></div></div><p class="player-hint">Join or find your name to play.</p>';
}

export function renderPeople(state) {
  const query = $('search').value.trim().toLocaleLowerCase();
  const scroll = $('people').scrollTop;
  $('people').innerHTML = [...state.people].reverse().filter(p =>
    p.name.toLocaleLowerCase().includes(query) || playerNumber(p).includes(query)
  ).map(p => '<div class="person-row"><button data-action="select" data-person="' + p.id + '" class="person-info' +
    (p.id === state.activeId ? ' active' : '') + '"><span>' + escapeHtml(p.name) + ' · ' + playerNumber(p) +
    '</span><small>' + score(p) + '/50 · ' + (MAX_ROUNDS - p.results.length) + ' left</small></button><button data-action="rename" data-person="' +
    p.id + '" aria-label="Edit ' + escapeHtml(p.name) + '">Edit</button><button data-action="remove" data-person="' +
    p.id + '" aria-label="Remove ' + escapeHtml(p.name) + '">Remove</button></div>').join('') ||
    '<p class="board-empty">' + (query ? 'No matching players.' : 'No players registered.') + '</p>';
  $('people').scrollTop = scroll;
}

function stage(name) {
  const previous = document.body.dataset.stage;
  document.body.dataset.stage = name;
  for (const id of ['wheel', 'teaching', 'challenge', 'result', 'completion']) $(id + '-stage').hidden = id !== name;
  if (previous !== name) {
    if (previous === 'teaching') $('lesson-video').pause();
    if (previous === 'challenge') {
      $('reference-video').pause();
      $('reference-video').closest('details').open = false;
    }
  }
}

const setVideo = (id, sign) => {
  const element = $(id);
  const source = './lessons/' + sign.id + '.mp4';
  if (element.getAttribute('src') !== source) element.setAttribute('src', source);
  return element;
};
export function renderStage(kind, p, state, ui) {
  stage(kind);
  const sign = p?.pending ? signById[p.pending.sign] : null;
  if (kind === 'wheel') {
    $('wheel-hub').disabled = !p || ui.spinning;
    $('wheel-copy').innerHTML = p
      ? '<p class="eyebrow">ROUND ' + (p.results.length + 1) + ' OF 5</p><h1>Spin the <em>wheel.</em></h1><p class="description">The pointer picks your next ASL sign.</p>' +
        '<button class="primary gold" data-action="spin"' + (ui.spinning ? ' disabled' : '') + '>' + (ui.spinning ? 'Wheel spinning…' : 'Spin the wheel') + '</button>'
      : '<p class="eyebrow">SIGNRELAY GAMESHOW</p><h1>Spin. Sign. <em>Score.</em></h1><p class="description">Learn ASL. Beat the clock. Win a lollipop.</p>' +
        buy('open-players', 'Join the game');
  } else if (kind === 'teaching') {
    $('lesson-copy').innerHTML = '<p class="eyebrow">LEARN ROUND ' + (p.results.length + 1) + '</p><h1 id="lesson-title">' + sign.word +
      '</h1><p class="description">' + sign.cue + '</p><div class="button-row">' +
      '<button class="primary" data-action="start"' + (ui.starting ? ' disabled' : '') + '>' + (ui.starting ? 'Getting ready…' : 'Ready') + '</button>' +
      '</div>' + (ui.problem ? '<p class="player-hint" role="status">' + escapeHtml(ui.problem) + '</p>' : '');
    const video = setVideo('lesson-video', sign);
    if (!$('players').open && video.paused) video.play().catch(() => {});
  } else if (kind === 'challenge') {
    $('challenge-copy').innerHTML = '<p class="eyebrow">ROUND ' + (p.results.length + 1) + ' OF 5</p><h1 id="challenge-title">' + sign.word +
      '</h1><p class="meta">' + escapeHtml(p.name) + ' · ' + score(p) + '/50 points</p>';
    setVideo('reference-video', sign);
    $('challenge-actions').innerHTML = !p.pending.deadline ?
      '<button class="primary" data-action="start"' + (ui.starting ? ' disabled' : '') + '>' + (ui.starting ? 'Getting ready…' : 'Resume') + '</button>' : '';
    $('camera-message').innerHTML = ui.problem
      ? icon('camera') + '<span>' + escapeHtml(ui.problem) + '</span>'
      : state.settings.manual ? icon('hand') + '<span>Show the sign to your host</span>'
      : !p.pending.deadline ? icon('camera') + '<span>Challenge paused</span>'
      : !ui.operator ? '<span>Challenge running in the host tab</span>' : '';
  } else if (kind === 'result') {
    const r = ui.result;
    const correct = successful(r);
    const chain = streaks(p).current;
    const screen = $('result-stage');
    screen.classList.toggle('win', correct);
    screen.innerHTML = '<p class="eyebrow">' + signById[r.sign].word + ' · ROUND ' + p.results.length + ' OF 5</p><h1>' +
      (correct ? 'You signed it!' : 'Nice try!') + '</h1><div class="result-points">' + (correct ? '+10' : '+0') +
      ' <small>points</small></div>' + (correct && chain >= 3 ? '<p class="streak">' + icon('bolt') + ' ' + chain + '-SIGN STREAK</p>' : '') +
      '<p class="description">' + (correct ? score(p) + ' out of 50 points so far.' : 'Time’s up. Your next sign is a fresh start.') +
      '</p>' + buy('next', 'Next round');
  } else if (kind === 'completion') {
    const points = score(p);
    const perfect = points === 50;
    const rank = leaderboard(state.people).find(row => row.id === p.id)?.rank;
    const screen = $('completion-stage');
    screen.classList.toggle('perfect', perfect);
    screen.innerHTML = '<p class="eyebrow">SIGNRELAY GAMESHOW · FIVE ROUNDS COMPLETE</p><h1>' +
      (perfect ? 'Perfect game!' : 'Well played!') + '</h1><div class="result-points">' + points +
      ' <small>/ 50</small></div><p class="description">' + escapeHtml(p.name) + ', collect your lollipop from the host.</p>' +
      '<div class="result-stats"><span>' + points / 10 + ' correct</span><span>Best streak ' + streaks(p).best +
      '</span><span>Rank ' + rank + '</span></div><div class="button-row">' + buy('open-players', 'Next player') + '</div>';
  }
}

export function renderHost(state, ui) {
  const p = player(state);
  const r = p?.pending;
  $('host-round').innerHTML = p ? '<p>' + escapeHtml(p.name) + ' · ' + playerNumber(p) + ' · ' + score(p) + '/50</p>' +
    (r ? '<div class="button-row">' +
      (r.deadline ? button('pause', 'Pause') + button('manual', 'Confirm correct', 'primary') : button('start', r.ready ? 'Resume' : 'Start round')) +
      button('restart', 'Restart round') + button('skip', 'Skip round') + '</div>' : '') +
    (p.results.length ? '<details><summary>Correct a score</summary><div class="button-row">' + p.results.map(result =>
      '<button data-action="correct" data-challenge="' + result.id + '">' + signById[result.sign].word + ' · ' +
      (successful(result) ? 'set to 0' : 'award 10') + '</button>').join('') + '</div></details>' : '')
    : '<p>Select a player to manage their round.</p>';
  const { settings } = state;
  $('sensitivity').value = settings.mode;
  $('custom').value = Math.round(settings.custom * 100);
  $('custom-value').textContent = $('custom').value;
  $('custom-row').hidden = settings.mode !== 'custom';
  $('volume').value = Math.round(settings.volume * 100);
  $('volume-value').textContent = $('volume').value + '%';
  $('overlay-setting').checked = settings.overlay;
  $('manual').checked = settings.manual;
  $('camera-select').innerHTML = '<option value="">Default camera</option>' + ui.devices.map((d, i) =>
    '<option value="' + escapeHtml(d.deviceId) + '">' + escapeHtml(d.label || 'Camera ' + (i + 1)) + '</option>').join('');
  if (settings.camera && !ui.devices.some(d => d.deviceId === settings.camera)) {
    const option = document.createElement('option');
    option.value = settings.camera;
    option.textContent = 'Saved camera (unavailable)';
    $('camera-select').append(option);
  }
  $('camera-select').value = settings.camera;
}

export const threshold = settings => settings.mode === 'custom' ? settings.custom : MODES[settings.mode];

