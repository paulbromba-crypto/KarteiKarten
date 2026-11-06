import Foundation
import SwiftData

/// Ein Kartenstapel.
@Model
final class Deck {
    var id: UUID = UUID()
    var name: String = ""
    var createdAt: Date = Date()

    @Relationship(deleteRule: .cascade, inverse: \Card.deck)
    var cards: [Card] = []

    init(name: String, createdAt: Date = Date()) {
        self.id = UUID()
        self.name = name
        self.createdAt = createdAt
    }

    /// Karten in Erstellungsreihenfolge.
    var sortedCards: [Card] {
        cards.sorted { $0.order < $1.order }
    }

    var nextOrder: Int {
        (cards.map(\.order).max() ?? -1) + 1
    }
}

/// Eine Karteikarte.
@Model
final class Card {
    var id: UUID = UUID()
    var question: String = ""
    var answer: String = ""
    var practiceExample: String?
    var caseStudy: String?
    var caseSolution: String?
    var source: String?

    /// Phase 1–6 (6 = gelernt).
    var phase: Int = 1
    /// Gespeicherter `CardStatus` (Warteschlange / aktiv / gelernt).
    var statusRaw: String = CardStatus.queued.rawValue
    /// Erstellungsreihenfolge innerhalb des Stapels.
    var order: Int = 0
    /// Position in der aktiven 5er-Gruppe.
    var groupPosition: Int = 0
    var createdAt: Date = Date()

    var deck: Deck?

    init(
        question: String,
        answer: String,
        practiceExample: String? = nil,
        caseStudy: String? = nil,
        caseSolution: String? = nil,
        source: String? = nil,
        phase: Int = 1,
        order: Int
    ) {
        self.id = UUID()
        self.question = question
        self.answer = answer
        self.practiceExample = practiceExample.nonEmpty
        self.caseStudy = caseStudy.nonEmpty
        self.caseSolution = caseSolution.nonEmpty
        self.source = source.nonEmpty
        self.phase = min(max(phase, LearningEngine.minPhase), LearningEngine.maxPhase)
        self.statusRaw = CardStatus.queued.rawValue
        self.order = order
        self.createdAt = Date()
    }

    var status: CardStatus {
        get { CardStatus(rawValue: statusRaw) ?? .queued }
        set { statusRaw = newValue.rawValue }
    }

    var engineCard: EngineCard {
        EngineCard(id: id, phase: phase, status: status, order: order, groupPosition: groupPosition)
    }

    /// Übernimmt den Lernzustand aus der Lernlogik (nur geänderte Werte).
    func apply(_ state: EngineCard) {
        if phase != state.phase { phase = state.phase }
        if status != state.status { status = state.status }
        if order != state.order { order = state.order }
        if groupPosition != state.groupPosition { groupPosition = state.groupPosition }
    }
}

extension Optional where Wrapped == String {
    /// `nil`, wenn der Text leer ist oder nur aus Leerzeichen besteht.
    var nonEmpty: String? {
        guard let value = self?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }
}

extension Deck {
    /// Erstellt die Lernlogik für diesen Stapel.
    func makeEngine(phaseFilter: Int? = nil) -> LearningEngine {
        LearningEngine(cards: cards.map(\.engineCard), phaseFilter: phaseFilter)
    }

    /// Schreibt den Zustand der Lernlogik in die gespeicherten Karten zurück.
    func apply(_ engine: LearningEngine) {
        let byID = Dictionary(uniqueKeysWithValues: engine.cards.map { ($0.id, $0) })
        for card in cards {
            if let state = byID[card.id] { card.apply(state) }
        }
    }

    /// Stellt nach Änderungen (Karte hinzugefügt/gelöscht, Import) einen
    /// gültigen Lernzustand her.
    func normalizeLearningState() {
        apply(makeEngine())
    }

    /// Alle Karten zurück auf Phase 1.
    func resetProgress() {
        let engine = makeEngine()
        engine.reset()
        apply(engine)
    }

    /// Kennzahlen für die Übersicht.
    var statistics: DeckStatistics {
        DeckStatistics(cards: cards.map(\.engineCard))
    }
}

/// Kennzahlen eines Stapels: Karten pro Phase, Warteschlange, Fortschritt.
struct DeckStatistics: Equatable {
    var countsPerPhase: [Int: Int]
    var queueCount: Int
    var activeCount: Int
    var total: Int
    var learned: Int

    init(cards: [EngineCard]) {
        let engine = LearningEngine(cards: cards)
        countsPerPhase = Dictionary(uniqueKeysWithValues: (1...6).map { ($0, engine.count(inPhase: $0)) })
        queueCount = engine.queueCount
        activeCount = engine.activeGroup.count
        total = engine.cards.count
        learned = engine.learnedCount
    }

    /// Fortschritt in Prozent (0–100).
    var progressPercent: Double {
        total == 0 ? 0 : Double(learned) / Double(total) * 100
    }

    func count(inPhase phase: Int) -> Int { countsPerPhase[phase] ?? 0 }
}
