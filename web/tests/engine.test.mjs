// Portierung von KarteiKartenTests/LearningEngineTests.swift (alle 30 Tests).
// Ausführen: node --test web/tests

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LearningEngine, engineCard, GROUP_SIZE } from '../js/engine.js';

// MARK: - Hilfsfunktionen

/** Erzeugt `count` neue Karten in Erstellungsreihenfolge 0, 1, 2, … */
const makeCards = (count, phase = 1) => Array.from({ length: count }, (_, i) => engineCard({ phase, order: i }));
const orders = (cards) => cards.map((c) => c.order);
const shuffled = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// MARK: - Phasen

test('testNewCardsStartInPhaseOne', () => {
  const engine = new LearningEngine([]);
  const card = engine.addCard();
  assert.equal(card.phase, 1);
  assert.equal(engine.card(card.id).status, 'active');
});

test('testKnownIncreasesPhaseByOne', () => {
  const engine = new LearningEngine(makeCards(1));
  const id = engine.currentCard.id;
  engine.rateKnown();
  assert.equal(engine.card(id).phase, 2);
});

test('testUnknownDecreasesPhaseByOne', () => {
  const engine = new LearningEngine(makeCards(1, 3));
  const id = engine.currentCard.id;
  engine.rateUnknown();
  assert.equal(engine.card(id).phase, 2);
});

test('testPhaseNeverDropsBelowOne', () => {
  const engine = new LearningEngine(makeCards(1));
  const id = engine.currentCard.id;
  engine.rateUnknown();
  engine.rateUnknown();
  assert.equal(engine.card(id).phase, 1);
});

test('testPhaseSixIsLearnedAndNotAskedAnymore', () => {
  const engine = new LearningEngine(makeCards(1, 5));
  const id = engine.currentCard.id;
  engine.rateKnown();
  assert.equal(engine.card(id).phase, 6);
  assert.equal(engine.card(id).status, 'learned');
  assert.equal(engine.currentCard, null);
  assert.equal(engine.learningPhase, null);
  assert.equal(engine.rateKnown(), false, 'Es gibt keine Karte mehr zum Abfragen');
  assert.equal(engine.card(id).phase, 6, 'Phase 6 ist das Maximum');
});

test('testPhasesAreClampedWhenLoading', () => {
  const engine = new LearningEngine([engineCard({ phase: 0, order: 0 }), engineCard({ phase: 9, order: 1 })]);
  assert.deepEqual(engine.cards.map((c) => c.phase), [1, 6]);
  assert.equal(engine.cards[1].status, 'learned');
});

test('testCardFullyLearnedAfterFiveKnownRatings', () => {
  const engine = new LearningEngine(makeCards(1));
  const id = engine.currentCard.id;
  for (let i = 0; i < 5; i += 1) engine.rateKnown();
  assert.equal(engine.card(id).phase, 6);
  assert.equal(engine.progressPercent, 100);
});

// MARK: - 5er-Lerngruppe

test('testAtMostFiveCardsAreActive', () => {
  const engine = new LearningEngine(makeCards(12));
  assert.equal(engine.activeGroup.length, 5);
  assert.equal(engine.queueCount, 7);
});

test('testGroupIsFilledInCreationOrder', () => {
  const engine = new LearningEngine(shuffled(makeCards(8)));
  assert.deepEqual(orders(engine.activeGroup), [0, 1, 2, 3, 4]);
});

test('testFewerThanFiveCardsAllActive', () => {
  const engine = new LearningEngine(makeCards(3));
  assert.equal(engine.activeGroup.length, 3);
  assert.equal(engine.queueCount, 0);
});

test('testGroupOnlyContainsLowestPhase', () => {
  const engine = new LearningEngine([
    engineCard({ phase: 2, order: 0 }),
    engineCard({ phase: 1, order: 1 }),
    engineCard({ phase: 3, order: 2 }),
    engineCard({ phase: 1, order: 3 }),
    engineCard({ phase: 2, order: 4 }),
  ]);
  assert.equal(engine.learningPhase, 1);
  assert.deepEqual(orders(engine.activeGroup), [1, 3]);
  assert.ok(engine.activeGroup.every((c) => c.phase === 1));
});

test('testNextPhaseStartsOnlyWhenAllCardsReachedIt', () => {
  const engine = new LearningEngine(makeCards(7));
  for (let i = 0; i < 6; i += 1) engine.rateKnown();
  assert.equal(engine.learningPhase, 1);
  assert.deepEqual(orders(engine.activeGroup), [6]);
  assert.equal(engine.countInPhase(2), 6);

  engine.rateKnown();
  assert.equal(engine.learningPhase, 2);
  assert.deepEqual(orders(engine.activeGroup), [0, 1, 2, 3, 4]);
  assert.ok(engine.activeGroup.every((c) => c.phase === 2));
});

test('testUnknownKeepsCardInGroupAndRepeatsLaterInRound', () => {
  const engine = new LearningEngine(makeCards(7));
  const first = engine.currentCard;
  engine.rateUnknown();
  assert.equal(engine.card(first.id).status, 'active', 'Karte bleibt in der Gruppe');
  assert.equal(engine.activeGroup.length, 5);
  assert.deepEqual(orders(engine.activeGroup), [1, 2, 3, 4, 0], 'Karte kommt später in der Runde wieder');
  assert.notEqual(engine.currentCard.id, first.id);
});

test('testKnownLeavesGroupAndNextQueuedCardMovesUp', () => {
  const engine = new LearningEngine(makeCards(7));
  const first = engine.currentCard;
  engine.rateKnown();
  assert.equal(engine.card(first.id).status, 'queued', 'Karte verlässt die Gruppe');
  assert.equal(engine.card(first.id).phase, 2);
  assert.deepEqual(orders(engine.activeGroup), [1, 2, 3, 4, 5], 'Karte 5 rückt aus der Warteschlange nach');
});

test('testFallbackToLowerPhaseHasImmediatePriority', () => {
  const engine = new LearningEngine(makeCards(7, 2));
  assert.equal(engine.learningPhase, 2);
  const first = engine.currentCard;

  engine.rateUnknown();
  assert.equal(engine.card(first.id).phase, 1);
  assert.equal(engine.learningPhase, 1, 'Phase 1 hat sofort wieder Vorrang');
  assert.deepEqual(engine.activeGroup.map((c) => c.id), [first.id], 'Gruppe enthält nur noch Karten der Phase 1');
  assert.equal(engine.currentCard.id, first.id);

  engine.rateKnown();
  assert.equal(engine.learningPhase, 2);
  assert.equal(engine.activeGroup.length, 5);
});

test('testCardFromLowerPhaseAddedLaterTakesPriority', () => {
  const engine = new LearningEngine(makeCards(3, 3));
  assert.equal(engine.learningPhase, 3);
  const newCard = engine.addCard();
  assert.equal(engine.learningPhase, 1);
  assert.deepEqual(engine.activeGroup.map((c) => c.id), [newCard.id]);
});

// MARK: - Überspringen

test('testSkipMovesCardToEndOfGroupWithoutChangingPhase', () => {
  const engine = new LearningEngine(makeCards(5));
  const first = engine.currentCard;
  engine.skip();
  assert.deepEqual(orders(engine.activeGroup), [1, 2, 3, 4, 0]);
  assert.equal(engine.card(first.id).phase, 1);
  assert.equal(engine.canUndo, false, 'Überspringen ist keine Bewertung');
});

// MARK: - Rückgängig

test('testUndoRestoresPhaseAndGroup', () => {
  const engine = new LearningEngine(makeCards(7));
  const before = engine.cards;
  engine.rateKnown();
  assert.equal(engine.canUndo, true);
  engine.undo();
  assert.deepEqual(engine.cards, before);
  assert.equal(engine.canUndo, false);
});

test('testUndoIsMultiLevel', () => {
  const engine = new LearningEngine(makeCards(7));
  const s0 = engine.cards;
  engine.rateKnown();
  const s1 = engine.cards;
  engine.rateUnknown();
  const s2 = engine.cards;
  engine.rateKnown();

  assert.equal(engine.undo(), true); assert.deepEqual(engine.cards, s2);
  assert.equal(engine.undo(), true); assert.deepEqual(engine.cards, s1);
  assert.equal(engine.undo(), true); assert.deepEqual(engine.cards, s0);
  assert.equal(engine.undo(), false);
});

test('testUndoRestoresFallbackFromHigherPhase', () => {
  const engine = new LearningEngine(makeCards(7, 2));
  const before = engine.cards;
  engine.rateUnknown();
  assert.equal(engine.learningPhase, 1);
  engine.undo();
  assert.deepEqual(engine.cards, before);
  assert.equal(engine.learningPhase, 2);
});

test('testUndoRestoresLearnedCard', () => {
  const engine = new LearningEngine(makeCards(1, 5));
  const id = engine.currentCard.id;
  engine.rateKnown();
  assert.equal(engine.card(id).status, 'learned');
  engine.undo();
  assert.equal(engine.card(id).phase, 5);
  assert.equal(engine.card(id).status, 'active');
  assert.equal(engine.currentCard.id, id);
});

// MARK: - Zurücksetzen

test('testResetPutsAllCardsBackToPhaseOne', () => {
  const engine = new LearningEngine([
    engineCard({ phase: 6, order: 0 }),
    engineCard({ phase: 3, order: 1 }),
    engineCard({ phase: 2, order: 2 }),
  ]);
  engine.rateKnown();
  engine.reset();
  assert.ok(engine.cards.every((c) => c.phase === 1));
  assert.equal(engine.learningPhase, 1);
  assert.deepEqual(orders(engine.activeGroup), [0, 1, 2]);
  assert.equal(engine.progressPercent, 0);
  assert.equal(engine.canUndo, false);
});

// MARK: - Phasenauswahl

test('testPhaseFilterLearnsOnlySelectedPhase', () => {
  const engine = new LearningEngine([
    engineCard({ phase: 1, order: 0 }),
    engineCard({ phase: 3, order: 1 }),
    engineCard({ phase: 3, order: 2 }),
    engineCard({ phase: 2, order: 3 }),
  ]);
  assert.equal(engine.learningPhase, 1);

  engine.phaseFilter = 3;
  assert.equal(engine.learningPhase, 3);
  assert.deepEqual(orders(engine.activeGroup), [1, 2]);

  engine.rateKnown();
  assert.deepEqual(orders(engine.activeGroup), [2]);

  engine.phaseFilter = null;
  assert.equal(engine.learningPhase, 1);
  assert.deepEqual(orders(engine.activeGroup), [0]);
});

test('testPhaseFilterWithoutCardsHasNothingToLearn', () => {
  const engine = new LearningEngine(makeCards(3));
  engine.phaseFilter = 4;
  assert.equal(engine.learningPhase, null);
  assert.equal(engine.currentCard, null);
});

test('testPhaseFilterRejectsPhaseSix', () => {
  const engine = new LearningEngine(makeCards(3));
  engine.phaseFilter = 6;
  assert.equal(engine.phaseFilter, null);
  assert.equal(engine.learningPhase, 1);
});

// MARK: - Übersicht & Fortschritt

test('testCountsPerPhaseAndQueue', () => {
  const engine = new LearningEngine([
    engineCard({ phase: 1, order: 0 }),
    engineCard({ phase: 1, order: 1 }),
    engineCard({ phase: 2, order: 2 }),
    engineCard({ phase: 4, order: 3 }),
    engineCard({ phase: 6, order: 4 }),
    engineCard({ phase: 6, order: 5 }),
  ]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((p) => engine.countInPhase(p)), [2, 1, 0, 1, 0, 2]);
  assert.equal(engine.activeGroup.length, 2);
  assert.equal(engine.queueCount, 2, 'Karten in Phase 2 und 4 warten');
  assert.equal(engine.learnedCount, 2);
});

test('testProgressPercent', () => {
  const engine = new LearningEngine([
    engineCard({ phase: 6, order: 0 }),
    engineCard({ phase: 6, order: 1 }),
    engineCard({ phase: 3, order: 2 }),
    engineCard({ phase: 1, order: 3 }),
  ]);
  assert.ok(Math.abs(engine.progressPercent - 50) < 0.001);
  assert.equal(new LearningEngine([]).progressPercent, 0);
});

// MARK: - Laden gespeicherter Zustände

test('testSavedGroupOrderIsRestored', () => {
  const engine = new LearningEngine([
    engineCard({ phase: 1, status: 'active', order: 0, groupPosition: 2 }),
    engineCard({ phase: 1, status: 'active', order: 1, groupPosition: 0 }),
    engineCard({ phase: 1, status: 'active', order: 2, groupPosition: 1 }),
  ]);
  assert.deepEqual(orders(engine.activeGroup), [1, 2, 0]);
});

test('testRemovingCardRefillsGroup', () => {
  const engine = new LearningEngine(makeCards(6));
  engine.removeCard(engine.currentCard.id);
  assert.deepEqual(orders(engine.activeGroup), [1, 2, 3, 4, 5]);
});

// MARK: - Vollständiger Durchlauf

test('testFullRunEndsWithAllCardsLearned', () => {
  const engine = new LearningEngine(makeCards(12));
  let steps = 0;
  while (engine.currentCard !== null && steps < 10000) {
    if (steps % 3 === 2) engine.rateUnknown(); else engine.rateKnown();
    assert.ok(engine.activeGroup.length <= GROUP_SIZE);
    const phase = engine.learningPhase;
    if (phase !== null) {
      assert.ok(engine.activeGroup.every((c) => c.phase === phase));
      assert.equal(phase, Math.min(...engine.cards.filter((c) => c.phase < 6).map((c) => c.phase)));
    }
    steps += 1;
  }
  assert.equal(engine.learnedCount, 12);
  assert.equal(engine.progressPercent, 100);
});
