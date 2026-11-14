// Dauerhafte lokale Speicherung. Jede Änderung wird sofort gespeichert –
// in IndexedDB und zusätzlich als Kopie in localStorage. Beim Laden gewinnt
// der neuere Stand. Kein Server, keine Netzwerkzugriffe.

const SCHEMA = 1;
const DB_NAME = 'karteikarten';
const STORE_NAME = 'kv';
const KEY = 'state';
const LS_KEY = 'karteikarten.state';

export const EXPORT_REMINDER_DAYS = 14;

export function emptyState(now = new Date()) {
  return {
    schema: SCHEMA,
    decks: [],
    seeded: false,
    installedAt: now.toISOString(),
    lastExportAt: null,
    savedAt: null,
    revision: 0,
  };
}

// MARK: - Speicher-Backends

export function memoryBackend() {
  let value = null;
  return {
    name: 'memory',
    async read() { return value === null ? null : JSON.parse(value); },
    async write(state) { value = JSON.stringify(state); },
  };
}

export function localStorageBackend(storage = globalThis.localStorage) {
  return {
    name: 'localStorage',
    async read() {
      const raw = storage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    },
    async write(state) { storage.setItem(LS_KEY, JSON.stringify(state)); },
    /** Synchron – überlebt auch ein sofortiges Schließen/Neuladen der Seite. */
    writeSync(state) { storage.setItem(LS_KEY, JSON.stringify(state)); },
  };
}

export function indexedDBBackend(idb = globalThis.indexedDB) {
  let dbPromise = null;
  const open = () => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const request = idb.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return dbPromise;
  };
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const result = fn(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(result.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  return {
    name: 'IndexedDB',
    async read() { return (await run('readonly', (s) => s.get(KEY))) ?? null; },
    async write(state) { await run('readwrite', (s) => s.put(state, KEY)); },
  };
}

/** Standard im Browser: IndexedDB + localStorage (soweit verfügbar). */
export function browserBackends() {
  const list = [];
  try { if (globalThis.indexedDB) list.push(indexedDBBackend()); } catch { /* nicht verfügbar */ }
  try { if (globalThis.localStorage) list.push(localStorageBackend()); } catch { /* nicht verfügbar */ }
  if (list.length === 0) list.push(memoryBackend());
  return list;
}

// MARK: - Store

/** Neuerer Stand: höhere Revisionsnummer, bei Gleichstand späterer Zeitstempel. */
function isNewer(a, b) {
  const ra = a.revision || 0;
  const rb = b.revision || 0;
  if (ra !== rb) return ra > rb;
  return (a.savedAt || '') > (b.savedAt || '');
}

export class Store {
  constructor(backends) {
    this.backends = backends;
    this.state = emptyState();
    this._queue = Promise.resolve();
    this.lastError = null;
  }

  /** Lädt den neuesten gespeicherten Stand aus allen Backends. */
  async load() {
    let best = null;
    for (const backend of this.backends) {
      try {
        const value = await backend.read();
        if (value && Array.isArray(value.decks)) {
          if (!best || isNewer(value, best)) best = value;
        }
      } catch (error) {
        this.lastError = error;
      }
    }
    this.state = best ? { ...emptyState(), ...best } : emptyState();
    return this.state;
  }

  /** Speichert sofort (Schreibvorgänge laufen nacheinander, immer mit dem aktuellen Stand). */
  save() {
    this.state.savedAt = new Date().toISOString();
    this.state.revision = (this.state.revision || 0) + 1;
    const snapshot = JSON.parse(JSON.stringify(this.state));
    let ok = false;
    // Synchrone Speicher sofort beschreiben, damit nichts verloren geht,
    // falls die App direkt nach einer Aktion geschlossen wird.
    for (const backend of this.backends) {
      if (typeof backend.writeSync !== 'function') continue;
      try {
        backend.writeSync(snapshot);
        ok = true;
      } catch (error) {
        this.lastError = error;
      }
    }
    this._queue = this._queue.then(async () => {
      for (const backend of this.backends) {
        if (typeof backend.writeSync === 'function') continue;
        try {
          await backend.write(snapshot);
          ok = true;
        } catch (error) {
          this.lastError = error;
        }
      }
      if (!ok) throw this.lastError || new Error('Speichern fehlgeschlagen');
    }).catch((error) => {
      this.lastError = error;
      if (typeof this.onError === 'function') this.onError(error);
    });
    return this._queue;
  }

  /** Wartet, bis alle Schreibvorgänge abgeschlossen sind. */
  flush() { return this._queue; }

  deck(id) { return this.state.decks.find((d) => d.id === id) || null; }

  markExported(date = new Date()) {
    this.state.lastExportAt = date.toISOString();
    return this.save();
  }

  /** Soll an die Sicherung erinnert werden? (> 14 Tage seit letztem Export bzw. seit Installation) */
  needsExportReminder(now = new Date()) {
    if (this.state.decks.length === 0) return false;
    const reference = this.state.lastExportAt || this.state.installedAt;
    if (!reference) return false;
    const days = (now.getTime() - new Date(reference).getTime()) / 86400000;
    return days > EXPORT_REMINDER_DAYS;
  }

  daysSinceExport(now = new Date()) {
    if (!this.state.lastExportAt) return null;
    return Math.floor((now.getTime() - new Date(this.state.lastExportAt).getTime()) / 86400000);
  }
}
