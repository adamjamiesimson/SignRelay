import { initial, reduce } from './game.mjs';

export async function openStore(signs) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('signrelay-gameshow', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('session');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other GameShow tabs and reload.'));
    request.onsuccess = () => resolve(request.result);
  });
  const channel = new BroadcastChannel('signrelay-gameshow-state');
  const change = () => channel.postMessage('updated');
  const listeners = new Set();
  channel.onmessage = () => listeners.forEach(listener => listener());
  function transaction(action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('session', action ? 'readwrite' : 'readonly', action ? { durability: 'strict' } : undefined);
      const store = tx.objectStore('session');
      const read = store.get('show');
      let state;
      let changed = false;
      let failure;
      read.onsuccess = () => {
        try {
          const base = read.result ?? initial();
          state = action ? reduce(base, action, signs) : base;
          changed = state !== base;
          if (changed) store.put(state, 'show');
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        if (changed) change();
        resolve({ state, changed });
      };
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('Storage transaction failed.'));
    });
  }
  return { read: () => transaction(), dispatch: transaction, subscribe: fn => listeners.add(fn) };
}

