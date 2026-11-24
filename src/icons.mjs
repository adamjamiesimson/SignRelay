const paths = {
  sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m16 10 4 4m0-4-4 4"/>',
  fullscreen: '<path d="M9 4H5a1 1 0 0 0-1 1v4m11-5h4a1 1 0 0 1 1 1v4M4 15v4a1 1 0 0 0 1 1h4m11-5v4a1 1 0 0 1-1 1h-4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="m10 3-.6 2.2-1.5.9-2.2-.6-2 3.5 1.6 1.6v1.8L3.7 14l2 3.5 2.2-.6 1.5.9.6 2.2h4l.6-2.2 1.5-.9 2.2.6 2-3.5-1.6-1.6v-1.8L20.3 9l-2-3.5-2.2.6-1.5-.9L14 3z" transform="translate(0 0.5)"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  board: '<path d="M4 20h16M6 17v-5m6 5V5m6 12V9"/>',
  replay: '<path d="M4 12a8 8 0 1 1 2.5 5.8M4 5v7h7"/>',
  play: '<path d="m9 5 11 7-11 7z" fill="currentColor" stroke="none"/>',
  hand: '<path d="M5 13V9a1.5 1.5 0 0 1 3 0v3-7a1.5 1.5 0 0 1 3 0v7-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v9l1.5-2a1.6 1.6 0 0 1 2.6 1.9l-3.5 4.8a5.5 5.5 0 0 1-4.3 2.1h-2a6 6 0 0 1-6-6Z"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  bolt: '<path d="m13 2-8 12h6l-1 8 9-12h-6l1-8z"/>',
  camera: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  dot: '<circle cx="12" cy="12" r="5"/>',
};
export const icon = name => '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';

