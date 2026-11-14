// Lernlogik (Phasensystem ähnlich Leitner) – 1:1 portiert aus
// KarteiKarten/Logic/LearningEngine.swift. Kein Bezug zur Oberfläche,
// läuft im Browser und in Node (Tests).
//
// Regeln:
// - Neue Karten starten in Phase 1. „Kann ich“ → Phase +1, „Kann ich nicht“ → Phase −1 (min. 1, max. 6).
// - Phase 6 = gelernt, die Karte wird nicht mehr abgefragt.
// - Es wird immer die niedrigste noch nicht abgeschlossene Phase gelernt.
// - Höchstens 5 Karten sind gleichzeitig aktiv; die Gruppe wird nur aus Karten
//   dieser Phase gefüllt (in Erstellungsreihenfolge).
// - „Kann ich nicht“: Karte bleibt in der Gruppe und kommt später in derselben Runde wieder.
// - „Kann ich“: Karte steigt auf, verlässt die Gruppe und macht Platz für die nächste Karte.
// - Fällt eine Karte in eine niedrigere Phase zurück, hat diese Phase sofort wieder Vorrang.
// - Phasenauswahl („Nur Phase X“): Fällt eine Karte dabei in eine niedrigere Phase,
//   verlässt sie die gefilterte Runde und hat beim normalen Lernen wieder Vorrang.

export const MIN_PHASE = 1;
export const MAX_PHASE = 6;
export const GROUP_SIZE = 5;

export const Status = Object.freeze({
  queued: 'queued',   // Warteschlange
  active: 'active',   // in der aktiven 5er-Gruppe
  learned: 'learned', // Phase 6
});

let idCounter = 0;
export function newId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  idCounter += 1;
  return `id-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Erzeugt einen Lernzustand einer Karte. */
export function engineCard({ id = newId(), phase = 1, status = Status.queued, order, groupPosition = 0 }) {
  return { id, phase, status, order, groupPosition };
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const copyCard = (c) => ({ id: c.id, phase: c.phase, status: c.status, order: c.order, groupPosition: c.groupPosition });
const isValidFilter = (f) => Number.isInteger(f) && f >= MIN_PHASE && f < MAX_PHASE;

export class LearningEngine {
  /**
   * @param {Array<{id, phase, status, order, groupPosition}>} cards
   * @param {number|null} phaseFilter optional 1–5
   */
  constructor(cards, phaseFilter = null) {
    this._cards = cards.map(copyCard).sort((a, b) => a.order - b.order);
    this._undoStack = [];
    this._phaseFilter = isValidFilter(phaseFilter) ? phaseFilter : null;
    this._normalize();
  }

  // MARK: Abfragen

  /** Alle Karten (Kopien), sortiert nach Erstellungsreihenfolge. */
  get cards() { return this._cards.map(copyCard); }

  get phaseFilter() { return this._phaseFilter; }

  set phaseFilter(value) {
    const next = isValidFilter(value) ? value : null;
    if (next !== this._phaseFilter) {
      this._phaseFilter = next;
      this._normalize();
    }
  }

  /** Die Phase, die gerade gelernt wird (`null`, wenn nichts mehr zu lernen ist). */
  get learningPhase() {
    if (this._phaseFilter !== null) {
      return this._cards.some((c) => c.phase === this._phaseFilter) ? this._phaseFilter : null;
    }
    let min = null;
    for (const c of this._cards) {
      if (c.phase < MAX_PHASE && (min === null || c.phase < min)) min = c.phase;
    }
    return min;
  }

  /** Die aktive Lerngruppe in Abfragereihenfolge. */
  get activeGroup() {
    return this._activeInternal().map(copyCard);
  }

  /** Die Karte, die gerade abgefragt wird. */
  get currentCard() {
    const group = this._activeInternal();
    return group.length ? copyCard(group[0]) : null;
  }

  countInPhase(phase) { return this._cards.filter((c) => c.phase === phase).length; }

  /** Karten in der Warteschlange (weder aktiv noch gelernt). */
  get queueCount() { return this._cards.filter((c) => c.status === Status.queued).length; }

  get learnedCount() { return this.countInPhase(MAX_PHASE); }

  /** Lernfortschritt in Prozent: Karten in Phase 6 ÷ Gesamtkarten × 100. */
  get progressPercent() {
    if (this._cards.length === 0) return 0;
    return (this.learnedCount / this._cards.length) * 100;
  }

  get canUndo() { return this._undoStack.length > 0; }

  card(id) {
    const c = this._cards.find((x) => x.id === id);
    return c ? copyCard(c) : null;
  }

  // MARK: Aktionen

  /** „Kann ich“: aktuelle Karte steigt eine Phase auf und verlässt die Gruppe. */
  rateKnown() {
    const current = this._activeInternal()[0];
    if (!current) return false;
    this._pushUndo();
    const newPhase = Math.min(current.phase + 1, MAX_PHASE);
    current.phase = newPhase;
    current.status = newPhase === MAX_PHASE ? Status.learned : Status.queued;
    current.groupPosition = 0;
    this._normalize();
    return true;
  }

  /** „Kann ich nicht“: Phase −1, Karte bleibt in der Gruppe und kommt ans Ende der Runde. */
  rateUnknown() {
    const current = this._activeInternal()[0];
    if (!current) return false;
    this._pushUndo();
    current.phase = Math.max(current.phase - 1, MIN_PHASE);
    current.groupPosition = this._nextGroupPosition();
    this._normalize();
    return true;
  }

  /** „Überspringen“: aktuelle Karte ans Ende der Gruppe, ohne Bewertung. */
  skip() {
    const group = this._activeInternal();
    if (group.length < 2) return false;
    group[0].groupPosition = this._nextGroupPosition();
    this._normalize();
    return true;
  }

  /** „Rückgängig“: nimmt die letzte Bewertung vollständig zurück (mehrstufig). */
  undo() {
    const snapshot = this._undoStack.pop();
    if (!snapshot) return false;
    this._cards = snapshot.map(copyCard);
    this._normalize();
    return true;
  }

  /** „Zurücksetzen“: alle Karten zurück auf Phase 1. */
  reset() {
    for (const c of this._cards) {
      c.phase = MIN_PHASE;
      c.status = Status.queued;
      c.groupPosition = 0;
    }
    this._undoStack = [];
    this._normalize();
  }

  /** Neue Karte (Phase 1, am Ende der Reihenfolge). */
  addCard(id = newId()) {
    const order = this._cards.reduce((m, c) => Math.max(m, c.order), -1) + 1;
    this._cards.push(engineCard({ id, phase: MIN_PHASE, status: Status.queued, order }));
    this._normalize();
    return this.card(id);
  }

  removeCard(id) {
    this._cards = this._cards.filter((c) => c.id !== id);
    this._undoStack = this._undoStack.map((s) => s.filter((c) => c.id !== id));
    this._normalize();
  }

  // MARK: Interna

  _activeInternal() {
    return this._cards
      .filter((c) => c.status === Status.active)
      .sort((a, b) => a.groupPosition - b.groupPosition);
  }

  _pushUndo() { this._undoStack.push(this._cards.map(copyCard)); }

  _nextGroupPosition() {
    return this._cards
      .filter((c) => c.status === Status.active)
      .reduce((m, c) => Math.max(m, c.groupPosition), -1) + 1;
  }

  /** Stellt alle Regeln her (identisch zur Swift-Version). */
  _normalize() {
    // 1. Phasen begrenzen, Status „gelernt“ konsistent halten.
    for (const c of this._cards) {
      c.phase = clamp(Number.isInteger(c.phase) ? c.phase : MIN_PHASE, MIN_PHASE, MAX_PHASE);
      if (!Object.values(Status).includes(c.status)) c.status = Status.queued;
      if (c.phase === MAX_PHASE) c.status = Status.learned;
      else if (c.status === Status.learned) c.status = Status.queued;
    }

    // 2. Karten, die nicht (mehr) zur Lernphase gehören, verlassen die Gruppe.
    const target = this.learningPhase;
    for (const c of this._cards) {
      if (c.status === Status.active && c.phase !== target) {
        c.status = Status.queued;
        c.groupPosition = 0;
      }
    }

    // 3. Zu große Gruppen kürzen.
    let group = this._activeInternal();
    if (group.length > GROUP_SIZE) {
      for (const extra of group.slice(GROUP_SIZE)) {
        extra.status = Status.queued;
        extra.groupPosition = 0;
      }
      group = group.slice(0, GROUP_SIZE);
    }

    // 4. Aus der Warteschlange der Lernphase auffüllen (Erstellungsreihenfolge).
    if (target !== null && group.length < GROUP_SIZE) {
      const candidates = this._cards
        .filter((c) => c.status === Status.queued && c.phase === target)
        .sort((a, b) => a.order - b.order)
        .slice(0, GROUP_SIZE - group.length);
      group = group.concat(candidates);
    }

    // 5. Positionen lückenlos neu vergeben.
    group.forEach((c, position) => {
      c.status = Status.active;
      c.groupPosition = position;
    });
  }
}

/** Kennzahlen eines Stapels (wie DeckStatistics in Swift). */
export function deckStatistics(cards) {
  const engine = new LearningEngine(cards);
  const countsPerPhase = {};
  for (let p = 1; p <= 6; p += 1) countsPerPhase[p] = engine.countInPhase(p);
  return {
    countsPerPhase,
    queueCount: engine.queueCount,
    activeCount: engine.activeGroup.length,
    total: engine.cards.length,
    learned: engine.learnedCount,
    progressPercent: engine.progressPercent,
  };
}
