// Portierung von KarteiKartenTests/DeckTransferTests.swift (alle 7 Tests)
// plus Web-spezifische Tests: Austausch mit der iOS-App, Speichern, Erinnerung.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  decodeTransfer, deckFromTransfer, transferFromDeck, encodeDeck, statistics, TransferError,
} from '../js/model.js';
import { StudySession } from '../js/session.js';
import { Store, memoryBackend } from '../js/store.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const webSample = readFileSync(join(here, '..', 'data', 'sample-deck.json'), 'utf8');
const iosSample = readFileSync(join(repoRoot, 'KarteiKarten', 'Resources', 'BWL-VWL-Grundbegriffe.json'), 'utf8');

const transfer = (name, karten) => ({ name, karten });
const numbered = (n) => Array.from({ length: n }, (_, i) => ({ frage: `F${i + 1}`, antwort: `A${i + 1}` }));

// MARK: - Portiert aus DeckTransferTests.swift

test('testDecodeMinimalDeck', () => {
  const t = decodeTransfer('{ "name": "Test", "karten": [ { "frage": "F1", "antwort": "A1" } ] }');
  assert.equal(t.name, 'Test');
  assert.equal(t.karten.length, 1);
  assert.equal(t.karten[0].praxisbeispiel, undefined);
});

test('testDecodeRejectsMissingAnswer', () => {
  assert.throws(() => decodeTransfer('{ "name": "Test", "karten": [ { "frage": "F1" } ] }'), TransferError);
});

test('testDecodeRejectsEmptyDeck', () => {
  assert.throws(() => decodeTransfer('{ "name": "Test", "karten": [] }'), (e) => e instanceof TransferError && e.kind === 'noCards');
});

test('testRoundTripKeepsAllFieldsAndPhases', () => {
  const deck = deckFromTransfer(transfer('Runde', [
    { frage: 'F1', antwort: 'A1', praxisbeispiel: 'P1', fallbeispiel: 'Fall', loesung: 'L', quelle: 'Q', phase: 3 },
    { frage: 'F2', antwort: 'A2' },
  ]));
  assert.equal(deck.cards.length, 2);

  const exported = decodeTransfer(encodeDeck(deck));
  assert.equal(exported.name, 'Runde');
  assert.equal(exported.karten[0].frage, 'F1');
  assert.equal(exported.karten[0].praxisbeispiel, 'P1');
  assert.equal(exported.karten[0].fallbeispiel, 'Fall');
  assert.equal(exported.karten[0].loesung, 'L');
  assert.equal(exported.karten[0].quelle, 'Q');
  assert.equal(exported.karten[0].phase, 3);
  assert.equal(exported.karten[1].phase, 1, 'Ohne Angabe startet eine Karte in Phase 1');
});

test('testImportedDeckHasActiveGroupOfFive', () => {
  const deck = deckFromTransfer(transfer('Viele', numbered(8)));
  assert.equal(deck.cards.filter((c) => c.status === 'active').length, 5);
  assert.equal(statistics(deck).queueCount, 3);
});

test('testSampleDeckIsValid', () => {
  const sample = decodeTransfer(webSample);
  assert.equal(sample.name, 'BWL/VWL Grundbegriffe');
  assert.equal(sample.karten.length, 15);
  assert.ok(sample.karten.every((k) => k.praxisbeispiel), 'Jede Karte hat ein Praxisbeispiel');
  assert.ok(sample.karten.filter((k) => k.fallbeispiel && k.loesung).length >= 3);
  assert.equal(sample.karten.filter((k) => k.fallbeispiel && k.loesung).length, 5);
});

test('testStudySessionPersistsAfterEachAction', async () => {
  const store = new Store([memoryBackend()]);
  await store.load();
  const deck = deckFromTransfer(transfer('Sitzung', numbered(6)));
  store.state.decks.push(deck);

  const session = new StudySession(deck, store);
  const first = session.currentCard;
  session.rateKnown();
  assert.equal(first.phase, 2);
  assert.equal(first.status, 'queued');

  // Neuer Store aus demselben Speicher (wie nach Neuladen der Seite).
  await store.flush();
  const reloadedStore = new Store(store.backends);
  await reloadedStore.load();
  const reloadedDeck = reloadedStore.deck(deck.id);
  const reloaded = new StudySession(reloadedDeck, reloadedStore);
  assert.equal(reloaded.statistics.countsPerPhase[2], 1);
  assert.notEqual(reloaded.currentCard.id, first.id);

  session.undo();
  assert.equal(first.phase, 1);
});

// MARK: - Austausch mit der iOS-App

test('Beispielstapel ist identisch mit dem der iOS-App', () => {
  assert.deepEqual(JSON.parse(webSample), JSON.parse(iosSample));
});

test('Export aus der iOS-App (Swift JSONEncoder, sortierte Schlüssel) lässt sich importieren', () => {
  // So schreibt die iOS-App: prettyPrinted + sortedKeys, nil-Felder fehlen, " : " als Trenner.
  const fromIOS = `{
  "format" : "karteikarten-stapel",
  "karten" : [
    {
      "antwort" : "A1",
      "fallbeispiel" : "Fall",
      "frage" : "F1",
      "loesung" : "L",
      "phase" : 4,
      "praxisbeispiel" : "P",
      "quelle" : "Q"
    },
    {
      "antwort" : "A2",
      "frage" : "F2",
      "phase" : 6
    }
  ],
  "name" : "Aus iOS",
  "version" : 1
}`;
  const deck = deckFromTransfer(decodeTransfer(fromIOS));
  assert.equal(deck.name, 'Aus iOS');
  assert.equal(deck.cards[0].phase, 4);
  assert.equal(deck.cards[0].caseSolution, 'L');
  assert.equal(deck.cards[1].phase, 6);
  assert.equal(deck.cards[1].status, 'learned');
  assert.equal(deck.cards[1].practiceExample, null);
});

test('Web-Export entspricht dem Format, das die iOS-App erwartet', () => {
  const deck = deckFromTransfer(transfer('Web', [
    { frage: 'F', antwort: 'A', praxisbeispiel: 'P', phase: 2 },
    { frage: 'G', antwort: 'B' },
  ]));
  const json = JSON.parse(encodeDeck(deck));
  assert.equal(json.format, 'karteikarten-stapel');
  assert.equal(json.version, 1);
  assert.equal(typeof json.name, 'string');
  for (const k of json.karten) {
    assert.equal(typeof k.frage, 'string');
    assert.equal(typeof k.antwort, 'string');
    assert.ok(Number.isInteger(k.phase) && k.phase >= 1 && k.phase <= 6);
    for (const key of Object.keys(k)) {
      assert.ok(['frage', 'antwort', 'praxisbeispiel', 'fallbeispiel', 'loesung', 'quelle', 'phase'].includes(key), key);
    }
    // Swift erwartet String oder fehlendes Feld, niemals null.
    for (const v of Object.values(k)) assert.notEqual(v, null);
  }
  assert.equal(json.karten[1].praxisbeispiel, undefined);
});

test('Ungültiges JSON und falsche Datentypen geben verständliche Fehler', () => {
  assert.throws(() => decodeTransfer('{ "name": '), /Klammern/);
  assert.throws(() => decodeTransfer('{ "karten": [] }'), /„name“/);
  assert.throws(() => decodeTransfer('{ "name": "X", "karten": [ { "frage": 1, "antwort": "A" } ] }'), /Karte 1/);
  assert.throws(() => decodeTransfer('{ "name": "X", "karten": [ { "frage": "F", "antwort": "A", "phase": "2" } ] }'), /phase/);
});

test('Leerer Name wird zu „Importierter Stapel“, leere Karten werden übersprungen', () => {
  const t = decodeTransfer({ name: '  ', karten: [{ frage: ' ', antwort: 'x' }, { frage: 'F', antwort: 'A' }] });
  assert.equal(t.name, 'Importierter Stapel');
  assert.equal(t.karten.length, 1);
});

test('Phasen außerhalb 1–6 werden beim Import begrenzt', () => {
  const deck = deckFromTransfer(transfer('P', [{ frage: 'F', antwort: 'A', phase: 9 }, { frage: 'G', antwort: 'B', phase: -2 }]));
  assert.deepEqual(deck.cards.map((c) => c.phase), [6, 1]);
});

// MARK: - Speicher

test('Store lädt den neueren Stand, wenn zwei Speicher abweichen', async () => {
  const a = memoryBackend();
  const b = memoryBackend();
  await a.write({ decks: [{ id: 'alt', name: 'Alt', cards: [] }], savedAt: '2026-01-01T00:00:00.000Z' });
  await b.write({ decks: [{ id: 'neu', name: 'Neu', cards: [] }], savedAt: '2026-02-01T00:00:00.000Z' });
  const store = new Store([a, b]);
  await store.load();
  assert.equal(store.state.decks[0].id, 'neu');
});

test('Store speichert weiter, wenn ein Speicher ausfällt', async () => {
  const broken = { name: 'kaputt', read: async () => { throw new Error('x'); }, write: async () => { throw new Error('x'); } };
  const ok = memoryBackend();
  const store = new Store([broken, ok]);
  await store.load();
  store.state.decks.push({ id: 'd', name: 'D', cards: [] });
  await store.save();
  assert.equal((await ok.read()).decks.length, 1);
});

test('Export-Erinnerung nach mehr als 14 Tagen', async () => {
  const store = new Store([memoryBackend()]);
  await store.load();
  const now = new Date('2026-03-20T12:00:00Z');
  store.state.installedAt = '2026-03-10T12:00:00Z';
  store.state.decks.push({ id: 'd', name: 'D', cards: [] });
  assert.equal(store.needsExportReminder(now), false, '10 Tage seit Installation');

  store.state.installedAt = '2026-03-01T12:00:00Z';
  assert.equal(store.needsExportReminder(now), true, '19 Tage ohne Export');

  await store.markExported(new Date('2026-03-15T12:00:00Z'));
  assert.equal(store.needsExportReminder(now), false, 'vor 5 Tagen exportiert');
  assert.equal(store.needsExportReminder(new Date('2026-03-30T13:00:00Z')), true, 'vor 15 Tagen exportiert');
});

test('Speichern ist sofort (synchron) im localStorage, auch ohne auf IndexedDB zu warten', async () => {
  const { localStorageBackend } = await import('../js/store.js');
  const data = new Map();
  const fakeStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const slow = { name: 'langsam', read: async () => null, write: () => new Promise(() => {}) };
  const store = new Store([slow, localStorageBackend(fakeStorage)]);
  await store.load();
  store.state.decks.push({ id: 'x', name: 'X', cards: [] });
  store.save(); // bewusst nicht abwarten
  const reloaded = new Store([slow, localStorageBackend(fakeStorage)]);
  await reloaded.load();
  assert.equal(reloaded.state.decks[0].id, 'x');
});

test('Bei gleicher Zeit gewinnt die höhere Revision', async () => {
  const a = memoryBackend();
  const b = memoryBackend();
  const t = '2026-01-01T00:00:00.000Z';
  await a.write({ decks: [{ id: 'alt' }], savedAt: t, revision: 4 });
  await b.write({ decks: [{ id: 'neu' }], savedAt: t, revision: 5 });
  const store = new Store([a, b]);
  await store.load();
  assert.equal(store.state.decks[0].id, 'neu');
});
