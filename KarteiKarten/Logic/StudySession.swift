import Foundation
import Observation
import SwiftData

/// Verbindet die Lernlogik mit den gespeicherten Karten eines Stapels.
/// Nach jeder Aktion wird der Fortschritt automatisch gespeichert.
@Observable
final class StudySession {
    let deck: Deck
    private let engine: LearningEngine
    private let context: ModelContext

    private(set) var currentCard: Card?
    private(set) var learningPhase: Int?
    private(set) var groupCount = 0
    private(set) var canUndo = false
    private(set) var statistics: DeckStatistics
    /// Zählt Aktionen hoch – nützlich für Animationen.
    private(set) var revision = 0

    /// Gezielt nur eine Phase lernen (`nil` = niedrigste offene Phase).
    private(set) var phaseFilter: Int?

    func setPhaseFilter(_ phase: Int?) {
        engine.phaseFilter = phase
        commit()
    }

    init(deck: Deck, context: ModelContext, phaseFilter: Int? = nil) {
        self.deck = deck
        self.context = context
        self.engine = deck.makeEngine(phaseFilter: phaseFilter)
        self.statistics = DeckStatistics(cards: [])
        commit()
    }

    func rateKnown() { if engine.rateKnown() { commit() } }
    func rateUnknown() { if engine.rateUnknown() { commit() } }
    func skip() { if engine.skip() { commit() } }
    func undo() { if engine.undo() { commit() } }

    func reset() {
        engine.reset()
        commit()
    }

    var canSkip: Bool { groupCount > 1 }

    /// Schreibt den Zustand zurück, speichert und aktualisiert die Anzeige.
    private func commit() {
        deck.apply(engine)
        do {
            try context.save()
        } catch {
            print("Speichern fehlgeschlagen: \(error)")
        }

        let currentID = engine.currentCard?.id
        currentCard = deck.cards.first { $0.id == currentID }
        learningPhase = engine.learningPhase
        phaseFilter = engine.phaseFilter
        groupCount = engine.activeGroup.count
        canUndo = engine.canUndo
        statistics = DeckStatistics(cards: engine.cards)
        revision += 1
    }
}
