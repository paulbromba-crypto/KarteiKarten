// Verbindet die Lernlogik mit einem gespeicherten Stapel (wie StudySession.swift).
// Nach jeder Aktion wird der Fortschritt sofort gespeichert.

import { applyEngine, makeEngine, statistics } from './model.js';

export class StudySession {
  /**
   * @param {object} deck Stapel aus dem Store
   * @param {{save: () => Promise}} store
   * @param {number|null} phaseFilter
   */
  constructor(deck, store, phaseFilter = null) {
    this.deck = deck;
    this.store = store;
    this.engine = makeEngine(deck, phaseFilter);
    this._commit();
  }

  get currentCard() {
    const current = this.engine.currentCard;
    return current ? this.deck.cards.find((c) => c.id === current.id) || null : null;
  }

  get learningPhase() { return this.engine.learningPhase; }
  get phaseFilter() { return this.engine.phaseFilter; }
  get groupCount() { return this.engine.activeGroup.length; }
  get canUndo() { return this.engine.canUndo; }
  get canSkip() { return this.groupCount > 1; }
  get statistics() { return statistics(this.deck); }

  setPhaseFilter(phase) {
    this.engine.phaseFilter = phase;
    return this._commit();
  }

  rateKnown() { return this.engine.rateKnown() && this._commit(); }
  rateUnknown() { return this.engine.rateUnknown() && this._commit(); }
  skip() { return this.engine.skip() && this._commit(); }
  undo() { return this.engine.undo() && this._commit(); }

  reset() {
    this.engine.reset();
    return this._commit();
  }

  _commit() {
    applyEngine(this.deck, this.engine);
    this.store.save();
    return true;
  }
}
