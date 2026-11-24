export const CANDIDATES = [
  { id: 'hello', word: 'HELLO', cue: 'Start with a flat hand by your forehead and move it outward.' },
  { id: 'help', word: 'HELP', cue: 'Set a thumbs-up fist on your open palm and lift both hands together.' },
  { id: 'no', word: 'NO', cue: 'Tap your first two fingers down to your thumb, like a small mouth closing.' },
  { id: 'please', word: 'PLEASE', cue: 'Place a flat hand on your chest and move it in a circle.' },
  { id: 'sorry', word: 'SORRY', cue: 'Make a loose fist and circle it against your chest.' },
  { id: 'drink', word: 'DRINK', cue: 'Curve your hand like you are holding a cup and tip it toward your mouth.' },
  { id: 'stop', word: 'STOP', cue: 'Hold your hand upright and make a quick stopping motion, as shown.' },
  { id: 'sleep', word: 'SLEEP', cue: 'Lower your open hand down the center of your face as your fingers close together.' },
  { id: 'jump', word: 'JUMP', cue: 'Bend your first two fingers like little legs and make them spring upward.' },
  { id: 'draw', word: 'DRAW', cue: 'Start with your curved finger by your lips. Follow the small drawing stroke in the clip.' },
  { id: 'pencil', word: 'PENCIL', cue: 'Touch your bent index finger to your lips, then move your hand outward as if writing.' },
  { id: 'green', word: 'GREEN', cue: 'Point your index finger and thumb sideways, then shake your hand gently.' },
  { id: 'rock', word: 'ROCK', cue: 'Tap the backs of your curled fingers against the underside of your chin twice.' },
  { id: 'who', word: 'WHO', cue: 'Touch your thumb near your chin, then bend your index finger a few times.' },
  { id: 'eat', word: 'EAT', cue: 'Bring your fingertips and thumb together, then touch them to your lips.' },
];
const wheelOrder = ['please', 'drink', 'draw', 'jump', 'green', 'stop', 'sleep', 'who', 'rock', 'pencil'];
export const SIGNS = wheelOrder.map(id => CANDIDATES.find(sign => sign.id === id));
export const signIds = SIGNS.map(s => s.id);
export const signById = Object.fromEntries(SIGNS.map(s => [s.id, s]));

