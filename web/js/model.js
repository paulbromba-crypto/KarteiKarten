// Datenmodell (Stapel, Karte) und JSON-Import/-Export.
// Entspricht Models.swift und DeckTransfer.swift der iOS-App – gleiches JSON-Format.

import { LearningEngine, MIN_PHASE, MAX_PHASE, Status, newId, deckStatistics } from './engine.js';

export const FORMAT_NAME = 'karteikarten-stapel';
export const FORMAT_VERSION = 1;

/** `null`, wenn der Text leer ist oder nur aus Leerzeichen besteht. */
export function nonEmpty(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// MARK: - Modell

export function createDeck(name, createdAt = new Date().toISOString()) {
  return { id: newId(), name, createdAt, cards: [] };
}

export function createCard({ question, answer, practiceExample, caseStudy, caseSolution, source, phase = 1, order }) {
  return {
    id: newId(),
    question,
    answer,
    practiceExample: nonEmpty(practiceExample),
    caseStudy: nonEmpty(caseStudy),
    caseSolution: nonEmpty(caseSolution),
    source: nonEmpty(source),
    phase: Math.min(Math.max(Number.isInteger(phase) ? phase : 1, MIN_PHASE), MAX_PHASE),
    status: Status.queued,
    order,
    groupPosition: 0,
    createdAt: new Date().toISOString(),
  };
}

export const sortedCards = (deck) => [...deck.cards].sort((a, b) => a.order - b.order);
export const nextOrder = (deck) => deck.cards.reduce((m, c) => Math.max(m, c.order), -1) + 1;

export function makeEngine(deck, phaseFilter = null) {
  return new LearningEngine(deck.cards, phaseFilter);
}

/** Schreibt den Zustand der Lernlogik in die Karten des Stapels zurück. */
export function applyEngine(deck, engine) {
  const byId = new Map(engine.cards.map((c) => [c.id, c]));
  for (const card of deck.cards) {
    const state = byId.get(card.id);
    if (state) {
      card.phase = state.phase;
      card.status = state.status;
      card.order = state.order;
      card.groupPosition = state.groupPosition;
    }
  }
}

/** Gültigen Lernzustand herstellen (nach Hinzufügen/Löschen/Import). */
export function normalizeDeck(deck) {
  applyEngine(deck, makeEngine(deck));
}

export function resetDeck(deck) {
  const engine = makeEngine(deck);
  engine.reset();
  applyEngine(deck, engine);
}

export const statistics = (deck) => deckStatistics(deck.cards);

// MARK: - JSON-Format

export class TransferError extends Error {
  constructor(kind, detail = '') {
    const messages = {
      unreadable: 'Die Datei konnte nicht gelesen werden.',
      invalidJSON: `Die Datei ist kein gültiger Stapel im JSON-Format.\n${detail}`,
      noCards: 'Der Stapel enthält keine Karten mit Frage und Antwort.',
    };
    super(messages[kind] || messages.unreadable);
    this.kind = kind;
  }
}

const OPTIONAL_TEXT = ['praxisbeispiel', 'fallbeispiel', 'loesung', 'quelle'];

/**
 * Liest einen Stapel im JSON-Format (Text oder bereits geparstes Objekt).
 * Prüft wie die iOS-App: `name`, `karten`, `frage`, `antwort` sind Pflicht.
 */
export function decodeTransfer(input) {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input.replace(/^﻿/, ''));
    } catch {
      throw new TransferError('invalidJSON', 'Bitte prüfe Klammern, Kommas und Anführungszeichen.');
    }
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new TransferError('invalidJSON', 'Falscher Datentyp.');
  }
  if (!('name' in data)) throw new TransferError('invalidJSON', 'Es fehlt das Feld „name“.');
  if (typeof data.name !== 'string') throw new TransferError('invalidJSON', 'Falscher Datentyp (bei: name).');
  if (!('karten' in data)) throw new TransferError('invalidJSON', 'Es fehlt das Feld „karten“.');
  if (!Array.isArray(data.karten)) throw new TransferError('invalidJSON', 'Falscher Datentyp (bei: karten).');

  const karten = data.karten.map((item, index) => {
    const where = `Karte ${index + 1}`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TransferError('invalidJSON', `Falscher Datentyp (bei: karten → ${where}).`);
    }
    for (const key of ['frage', 'antwort']) {
      if (!(key in item)) throw new TransferError('invalidJSON', `Es fehlt das Feld „${key}“ (bei: karten → ${where}).`);
      if (typeof item[key] !== 'string') throw new TransferError('invalidJSON', `Falscher Datentyp (bei: karten → ${where} → ${key}).`);
    }
    const card = { frage: item.frage, antwort: item.antwort };
    for (const key of OPTIONAL_TEXT) {
      const value = item[key];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'string') throw new TransferError('invalidJSON', `Falscher Datentyp (bei: karten → ${where} → ${key}).`);
      card[key] = value;
    }
    if (item.phase !== undefined && item.phase !== null) {
      if (!Number.isInteger(item.phase)) throw new TransferError('invalidJSON', `Falscher Datentyp (bei: karten → ${where} → phase).`);
      card.phase = item.phase;
    }
    return card;
  }).filter((k) => k.frage.trim() !== '' && k.antwort.trim() !== '');

  if (karten.length === 0) throw new TransferError('noCards');

  const name = data.name.trim() || 'Importierter Stapel';
  return { format: FORMAT_NAME, version: FORMAT_VERSION, name, karten };
}

/** Erzeugt aus einem gelesenen Stapel einen neuen Stapel mit gültigem Lernzustand. */
export function deckFromTransfer(transfer) {
  const deck = createDeck(transfer.name);
  transfer.karten.forEach((item, index) => {
    deck.cards.push(createCard({
      question: item.frage.trim(),
      answer: item.antwort.trim(),
      practiceExample: item.praxisbeispiel,
      caseStudy: item.fallbeispiel,
      caseSolution: item.loesung,
      source: item.quelle,
      phase: item.phase ?? 1,
      order: index,
    }));
  });
  normalizeDeck(deck);
  return deck;
}

/** Stapel → JSON-Objekt (fehlende optionale Felder werden weggelassen, wie in iOS). */
export function transferFromDeck(deck) {
  return {
    format: FORMAT_NAME,
    version: FORMAT_VERSION,
    name: deck.name,
    karten: sortedCards(deck).map((c) => {
      const out = { frage: c.question, antwort: c.answer };
      if (c.practiceExample) out.praxisbeispiel = c.practiceExample;
      if (c.caseStudy) out.fallbeispiel = c.caseStudy;
      if (c.caseSolution) out.loesung = c.caseSolution;
      if (c.source) out.quelle = c.source;
      out.phase = c.phase;
      return out;
    }),
  };
}

export function encodeDeck(deck) {
  return `${JSON.stringify(transferFromDeck(deck), null, 2)}\n`;
}

/** Dateiname ohne problematische Zeichen. */
export function safeFileName(name) {
  const cleaned = String(name).split(/[/\\?%*|"<>:]/).join('-').trim();
  return cleaned || 'Stapel';
}
