const tau = Math.PI * 2;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const palette = ['#3e865c','#255c41','#34754f','#276247','#3e8058','#265b40','#347c53','#235b41','#3b845b','#286347'];
const tones = {
  tick: [[610, 0, .026, .16, 'triangle']], spin: [[142, 0, .23, .12, 'sine'], [205, .095, .2, .11, 'sine']],
  select: [[494, 0, .12, .2], [659, .095, .17, .2], [784, .2, .24, .15]],
  start: [[380, 0, .11, .17], [585, .105, .13, .2]],
  final: [[377, 0, .07, .17]], win: [[523, 0, .22, .18], [659, .075, .25, .18], [784, .15, .34, .2], [1047, .235, .36, .17]],
  streak: [[392, 0, .14, .17], [523, .10, .16, .17], [784, .21, .25, .19], [1175, .36, .31, .15]],
  perfect: [[392, 0, .22, .18], [523, .11, .23, .16], [659, .22, .22, .18], [784, .33, .28, .17], [1047, .46, .4, .2], [1319,.56,.4,.13]],
  timeout: [[392, 0, .18, .16], [311, .14, .26, .11]],
};

export class Audio {
  constructor(settings) { this.settings = settings; }
  unlock() {
    const create = window.AudioContext ?? window.webkitAudioContext;
    if (!create) return;
    this.context ??= new create();
    if (this.context.state === 'suspended') this.context.resume().catch(() => {});
  }
  play(key) {
    const ctx = this.context;
    const { muted, volume } = this.settings();
    if (!ctx || ctx.state !== 'running' || muted || !volume) return;
    for (const [freq, offset, duration, strength, shape = 'sine'] of tones[key]) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + offset;
      oscillator.type = shape;
      oscillator.frequency.value = freq;
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(.001, volume * strength), start + .01);
      gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + .01);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
  }
}

export class Wheel {
  constructor(canvas, signs, audio) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.signs = signs;
    this.audio = audio;
    this.angle = 0;
    this.step = tau / signs.length;
    this.frame = 0;
    this.surface = document.createElement('canvas');
    this.surface.width = this.surface.height = 640;
    this.setUsed([]);
  }
  setUsed(used) {
    const key = used.join(',');
    if (key === this.used) return;
    this.used = key;
    const c = this.surface.getContext('2d');
    c.clearRect(0, 0, 640, 640);
    c.save();
    c.translate(320, 320);
    const rim = c.createLinearGradient(-310, -310, 310, 310);
    rim.addColorStop(0, '#f1d99f');
    rim.addColorStop(.42, '#988053');
    rim.addColorStop(.73, '#e3c983');
    rim.addColorStop(1, '#5f4c30');
    c.fillStyle = rim;
    c.beginPath();
    c.arc(0, 0, 307, 0, tau);
    c.fill();
    c.fillStyle = '#10291c';
    c.beginPath();
    c.arc(0, 0, 300, 0, tau);
    c.fill();
    for (const [i, sign] of this.signs.entries()) {
      const mid = i * this.step - Math.PI / 2;
      const usedSign = used.includes(sign.id);
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(0, 0, 284, mid - this.step / 2, mid + this.step / 2);
      c.closePath();
      c.fillStyle = usedSign ? '#243d30' : palette[i];
      c.fill();
      c.strokeStyle = '#9bc4a355';
      c.lineWidth = 2;
      c.stroke();
      c.beginPath();
      c.arc(293 * Math.cos(mid + this.step / 2), 293 * Math.sin(mid + this.step / 2), 3.4, 0, tau);
      c.fillStyle = '#f3d28f';
      c.fill();
      c.save();
      c.translate(190 * Math.cos(mid), 190 * Math.sin(mid));
      const tilt = mid + Math.PI / 2;
      c.rotate(tilt > Math.PI / 2 && tilt < 3 * Math.PI / 2 ? tilt - Math.PI : tilt);
      c.font = '750 ' + (sign.word.length > 7 ? '26' : '31') + 'px system-ui';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = usedSign ? '#a9baaa' : '#f8fff6';
      c.fillText(sign.word, 0, 0, 148);
      c.restore();
    }
    c.restore();
    this.draw();
  }
  draw() {
    const c = this.ctx;
    c.clearRect(0, 0, 640, 640);
    c.save();
    c.translate(320, 320);
    c.rotate(this.angle);
    c.drawImage(this.surface, -320, -320);
    c.restore();
  }
  stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.finish?.(false);
    this.finish = null;
  }
  idle() {
    this.stop();
    if (reduced()) return;
    const start = performance.now();
    const base = this.angle;
    const tick = now => {
      this.angle = base + Math.sin((now - start) / 5300) * .075;
      this.draw();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
  point(sign) {
    this.angle = -this.signs.findIndex(s => s.id === sign) * this.step;
    this.draw();
  }
  spin(sign) {
    this.stop();
    const index = this.signs.findIndex(s => s.id === sign);
    const duration = reduced() ? 230 : 3450;
    const start = performance.now();
    const base = this.angle;
    const target = -index * this.step;
    const delta = ((target - base) % tau + tau) % tau + (reduced() ? 0 : 4 * tau);
    let previous = Math.floor((base + this.step / 2) / this.step);
    this.audio.play('spin');
    return new Promise(done => {
      this.finish = done;
      const animate = now => {
        const t = Math.min(1, (now - start) / duration);
        const ease = 1 - (1 - t) ** 3 * (1 + 3 * t);
        this.angle = base + delta * ease;
        this.draw();
        const segment = Math.floor((this.angle + this.step / 2) / this.step);
        if (segment !== previous) {
          this.audio.play('tick');
          previous = segment;
        }
        if (t < 1) this.frame = requestAnimationFrame(animate);
        else {
          this.point(sign);
          this.finish = null;
          this.frame = 0;
          done(true);
        }
      };
      this.frame = requestAnimationFrame(animate);
    });
  }
}

let party;
export function confetti(canvas, level) {
  if (reduced()) return;
  cancelAnimationFrame(party);
  const context = canvas.getContext('2d');
  const width = innerWidth;
  const height = innerHeight;
  canvas.width = Math.round(width * devicePixelRatio);
  canvas.height = Math.round(height * devicePixelRatio);
  context.scale(devicePixelRatio, devicePixelRatio);
  const colors = ['#fbdb94', '#aeedb9', '#6fab82', '#fff7d8'];
  const pieces = Array.from({ length: level > 1 ? 138 : 72 }, (_, i) => ({
    x: width * (.25 + Math.random() * .5), y: height * .46,
    dx: (Math.random() - .5) * 17, dy: -5 - Math.random() * 12,
    size: 3 + Math.random() * 6, angle: Math.random() * tau, spin: (Math.random() - .5) * .4, color: colors[i % colors.length],
  }));
  const began = performance.now();
  let previous = began;
  const render = now => {
    const progress = (now - began) / (level > 1 ? 2750 : 1800);
    context.clearRect(0, 0, width, height);
    if (progress >= 1) return;
    const frameScale = Math.min(3, (now - previous) / 16.7);
    previous = now;
    context.globalAlpha = Math.min(1, (1 - progress) * 3);
    for (const part of pieces) {
      part.x += part.dx * frameScale;
      part.y += part.dy * frameScale;
      part.dy += .34 * frameScale;
      part.angle += part.spin * frameScale;
      context.save();
      context.translate(part.x, part.y);
      context.rotate(part.angle);
      context.fillStyle = part.color;
      context.fillRect(-part.size, -2, part.size * 2, 4);
      context.restore();
    }
    party = requestAnimationFrame(render);
  };
  party = requestAnimationFrame(render);
}

