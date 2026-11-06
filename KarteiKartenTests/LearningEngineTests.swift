import XCTest
@testable import KarteiKarten

final class LearningEngineTests: XCTestCase {

    // MARK: - Hilfsfunktionen

    /// Erzeugt `count` neue Karten in Erstellungsreihenfolge 0, 1, 2, …
    private func makeCards(_ count: Int, phase: Int = 1) -> [EngineCard] {
        (0..<count).map { EngineCard(phase: phase, order: $0) }
    }

    private func orders(_ cards: [EngineCard]) -> [Int] { cards.map(\.order) }

    // MARK: - Phasen

    func testNewCardsStartInPhaseOne() {
        let engine = LearningEngine(cards: [])
        let card = engine.addCard()
        XCTAssertEqual(card.phase, 1)
        XCTAssertEqual(engine.card(id: card.id)?.status, .active)
    }

    func testKnownIncreasesPhaseByOne() {
        let engine = LearningEngine(cards: makeCards(1))
        let id = engine.currentCard!.id
        engine.rateKnown()
        XCTAssertEqual(engine.card(id: id)?.phase, 2)
    }

    func testUnknownDecreasesPhaseByOne() {
        let engine = LearningEngine(cards: makeCards(1, phase: 3))
        let id = engine.currentCard!.id
        engine.rateUnknown()
        XCTAssertEqual(engine.card(id: id)?.phase, 2)
    }

    func testPhaseNeverDropsBelowOne() {
        let engine = LearningEngine(cards: makeCards(1))
        let id = engine.currentCard!.id
        engine.rateUnknown()
        engine.rateUnknown()
        XCTAssertEqual(engine.card(id: id)?.phase, 1)
    }

    func testPhaseSixIsLearnedAndNotAskedAnymore() {
        let engine = LearningEngine(cards: makeCards(1, phase: 5))
        let id = engine.currentCard!.id
        engine.rateKnown()
        XCTAssertEqual(engine.card(id: id)?.phase, 6)
        XCTAssertEqual(engine.card(id: id)?.status, .learned)
        XCTAssertNil(engine.currentCard)
        XCTAssertNil(engine.learningPhase)
        XCTAssertFalse(engine.rateKnown(), "Es gibt keine Karte mehr zum Abfragen")
        XCTAssertEqual(engine.card(id: id)?.phase, 6, "Phase 6 ist das Maximum")
    }

    func testPhasesAreClampedWhenLoading() {
        let engine = LearningEngine(cards: [
            EngineCard(phase: 0, order: 0),
            EngineCard(phase: 9, order: 1)
        ])
        XCTAssertEqual(engine.cards.map(\.phase), [1, 6])
        XCTAssertEqual(engine.cards[1].status, .learned)
    }

    func testCardFullyLearnedAfterFiveKnownRatings() {
        let engine = LearningEngine(cards: makeCards(1))
        let id = engine.currentCard!.id
        for _ in 0..<5 { engine.rateKnown() }
        XCTAssertEqual(engine.card(id: id)?.phase, 6)
        XCTAssertEqual(engine.progressPercent, 100)
    }

    // MARK: - 5er-Lerngruppe

    func testAtMostFiveCardsAreActive() {
        let engine = LearningEngine(cards: makeCards(12))
        XCTAssertEqual(engine.activeGroup.count, 5)
        XCTAssertEqual(engine.queueCount, 7)
    }

    func testGroupIsFilledInCreationOrder() {
        // Absichtlich gemischte Reihenfolge übergeben.
        let cards = makeCards(8).shuffled()
        let engine = LearningEngine(cards: cards)
        XCTAssertEqual(orders(engine.activeGroup), [0, 1, 2, 3, 4])
    }

    func testFewerThanFiveCardsAllActive() {
        let engine = LearningEngine(cards: makeCards(3))
        XCTAssertEqual(engine.activeGroup.count, 3)
        XCTAssertEqual(engine.queueCount, 0)
    }

    func testGroupOnlyContainsLowestPhase() {
        let cards = [
            EngineCard(phase: 2, order: 0),
            EngineCard(phase: 1, order: 1),
            EngineCard(phase: 3, order: 2),
            EngineCard(phase: 1, order: 3),
            EngineCard(phase: 2, order: 4)
        ]
        let engine = LearningEngine(cards: cards)
        XCTAssertEqual(engine.learningPhase, 1)
        XCTAssertEqual(orders(engine.activeGroup), [1, 3])
        XCTAssertTrue(engine.activeGroup.allSatisfy { $0.phase == 1 })
    }

    func testNextPhaseStartsOnlyWhenAllCardsReachedIt() {
        let engine = LearningEngine(cards: makeCards(7))
        // 6 von 7 Karten in Phase 2 bringen.
        for _ in 0..<6 { engine.rateKnown() }
        XCTAssertEqual(engine.learningPhase, 1)
        XCTAssertEqual(orders(engine.activeGroup), [6])
        XCTAssertEqual(engine.count(inPhase: 2), 6)

        // Letzte Karte aus Phase 1 → jetzt beginnt Phase 2.
        engine.rateKnown()
        XCTAssertEqual(engine.learningPhase, 2)
        XCTAssertEqual(orders(engine.activeGroup), [0, 1, 2, 3, 4])
        XCTAssertTrue(engine.activeGroup.allSatisfy { $0.phase == 2 })
    }

    func testUnknownKeepsCardInGroupAndRepeatsLaterInRound() {
        let engine = LearningEngine(cards: makeCards(7))
        let first = engine.currentCard!
        engine.rateUnknown()

        XCTAssertEqual(engine.card(id: first.id)?.status, .active, "Karte bleibt in der Gruppe")
        XCTAssertEqual(engine.activeGroup.count, 5)
        XCTAssertEqual(orders(engine.activeGroup), [1, 2, 3, 4, 0], "Karte kommt später in der Runde wieder")
        XCTAssertNotEqual(engine.currentCard?.id, first.id)
    }

    func testKnownLeavesGroupAndNextQueuedCardMovesUp() {
        let engine = LearningEngine(cards: makeCards(7))
        let first = engine.currentCard!
        engine.rateKnown()

        XCTAssertEqual(engine.card(id: first.id)?.status, .queued, "Karte verlässt die Gruppe")
        XCTAssertEqual(engine.card(id: first.id)?.phase, 2)
        XCTAssertEqual(orders(engine.activeGroup), [1, 2, 3, 4, 5], "Karte 5 rückt aus der Warteschlange nach")
    }

    func testFallbackToLowerPhaseHasImmediatePriority() {
        // Alle Karten in Phase 2, Gruppe wird aus Phase 2 gefüllt.
        let engine = LearningEngine(cards: makeCards(7, phase: 2))
        XCTAssertEqual(engine.learningPhase, 2)
        let first = engine.currentCard!

        engine.rateUnknown()

        XCTAssertEqual(engine.card(id: first.id)?.phase, 1)
        XCTAssertEqual(engine.learningPhase, 1, "Phase 1 hat sofort wieder Vorrang")
        XCTAssertEqual(engine.activeGroup.map(\.id), [first.id], "Gruppe enthält nur noch Karten der Phase 1")
        XCTAssertEqual(engine.currentCard?.id, first.id)

        // Sobald die Karte wieder Phase 2 erreicht, wird Phase 2 weitergelernt.
        engine.rateKnown()
        XCTAssertEqual(engine.learningPhase, 2)
        XCTAssertEqual(engine.activeGroup.count, 5)
    }

    func testCardFromLowerPhaseAddedLaterTakesPriority() {
        let engine = LearningEngine(cards: makeCards(3, phase: 3))
        XCTAssertEqual(engine.learningPhase, 3)
        let newCard = engine.addCard()
        XCTAssertEqual(engine.learningPhase, 1)
        XCTAssertEqual(engine.activeGroup.map(\.id), [newCard.id])
    }

    // MARK: - Überspringen

    func testSkipMovesCardToEndOfGroupWithoutChangingPhase() {
        let engine = LearningEngine(cards: makeCards(5))
        let first = engine.currentCard!
        engine.skip()
        XCTAssertEqual(orders(engine.activeGroup), [1, 2, 3, 4, 0])
        XCTAssertEqual(engine.card(id: first.id)?.phase, 1)
        XCTAssertFalse(engine.canUndo, "Überspringen ist keine Bewertung")
    }

    // MARK: - Rückgängig

    func testUndoRestoresPhaseAndGroup() {
        let engine = LearningEngine(cards: makeCards(7))
        let before = engine.cards
        engine.rateKnown()
        XCTAssertTrue(engine.canUndo)
        engine.undo()
        XCTAssertEqual(engine.cards, before)
        XCTAssertFalse(engine.canUndo)
    }

    func testUndoIsMultiLevel() {
        let engine = LearningEngine(cards: makeCards(7))
        let s0 = engine.cards
        engine.rateKnown()
        let s1 = engine.cards
        engine.rateUnknown()
        let s2 = engine.cards
        engine.rateKnown()

        XCTAssertTrue(engine.undo()); XCTAssertEqual(engine.cards, s2)
        XCTAssertTrue(engine.undo()); XCTAssertEqual(engine.cards, s1)
        XCTAssertTrue(engine.undo()); XCTAssertEqual(engine.cards, s0)
        XCTAssertFalse(engine.undo())
    }

    func testUndoRestoresFallbackFromHigherPhase() {
        let engine = LearningEngine(cards: makeCards(7, phase: 2))
        let before = engine.cards
        engine.rateUnknown()
        XCTAssertEqual(engine.learningPhase, 1)
        engine.undo()
        XCTAssertEqual(engine.cards, before)
        XCTAssertEqual(engine.learningPhase, 2)
    }

    func testUndoRestoresLearnedCard() {
        let engine = LearningEngine(cards: makeCards(1, phase: 5))
        let id = engine.currentCard!.id
        engine.rateKnown()
        XCTAssertEqual(engine.card(id: id)?.status, .learned)
        engine.undo()
        XCTAssertEqual(engine.card(id: id)?.phase, 5)
        XCTAssertEqual(engine.card(id: id)?.status, .active)
        XCTAssertEqual(engine.currentCard?.id, id)
    }

    // MARK: - Zurücksetzen

    func testResetPutsAllCardsBackToPhaseOne() {
        let cards = [
            EngineCard(phase: 6, order: 0),
            EngineCard(phase: 3, order: 1),
            EngineCard(phase: 2, order: 2)
        ]
        let engine = LearningEngine(cards: cards)
        engine.rateKnown()
        engine.reset()
        XCTAssertTrue(engine.cards.allSatisfy { $0.phase == 1 })
        XCTAssertEqual(engine.learningPhase, 1)
        XCTAssertEqual(orders(engine.activeGroup), [0, 1, 2])
        XCTAssertEqual(engine.progressPercent, 0)
        XCTAssertFalse(engine.canUndo)
    }

    // MARK: - Phasenauswahl

    func testPhaseFilterLearnsOnlySelectedPhase() {
        let cards = [
            EngineCard(phase: 1, order: 0),
            EngineCard(phase: 3, order: 1),
            EngineCard(phase: 3, order: 2),
            EngineCard(phase: 2, order: 3)
        ]
        let engine = LearningEngine(cards: cards)
        XCTAssertEqual(engine.learningPhase, 1)

        engine.phaseFilter = 3
        XCTAssertEqual(engine.learningPhase, 3)
        XCTAssertEqual(orders(engine.activeGroup), [1, 2])

        // Bestandene Karte verlässt die gefilterte Gruppe.
        engine.rateKnown()
        XCTAssertEqual(orders(engine.activeGroup), [2])

        engine.phaseFilter = nil
        XCTAssertEqual(engine.learningPhase, 1)
        XCTAssertEqual(orders(engine.activeGroup), [0])
    }

    func testPhaseFilterWithoutCardsHasNothingToLearn() {
        let engine = LearningEngine(cards: makeCards(3))
        engine.phaseFilter = 4
        XCTAssertNil(engine.learningPhase)
        XCTAssertNil(engine.currentCard)
    }

    func testPhaseFilterRejectsPhaseSix() {
        let engine = LearningEngine(cards: makeCards(3))
        engine.phaseFilter = 6
        XCTAssertNil(engine.phaseFilter)
        XCTAssertEqual(engine.learningPhase, 1)
    }

    // MARK: - Übersicht & Fortschritt

    func testCountsPerPhaseAndQueue() {
        let cards = [
            EngineCard(phase: 1, order: 0),
            EngineCard(phase: 1, order: 1),
            EngineCard(phase: 2, order: 2),
            EngineCard(phase: 4, order: 3),
            EngineCard(phase: 6, order: 4),
            EngineCard(phase: 6, order: 5)
        ]
        let engine = LearningEngine(cards: cards)
        XCTAssertEqual((1...6).map { engine.count(inPhase: $0) }, [2, 1, 0, 1, 0, 2])
        XCTAssertEqual(engine.activeGroup.count, 2)
        XCTAssertEqual(engine.queueCount, 2, "Karten in Phase 2 und 4 warten")
        XCTAssertEqual(engine.learnedCount, 2)
    }

    func testProgressPercent() {
        let cards = [
            EngineCard(phase: 6, order: 0),
            EngineCard(phase: 6, order: 1),
            EngineCard(phase: 3, order: 2),
            EngineCard(phase: 1, order: 3)
        ]
        XCTAssertEqual(LearningEngine(cards: cards).progressPercent, 50, accuracy: 0.001)
        XCTAssertEqual(LearningEngine(cards: []).progressPercent, 0)
    }

    // MARK: - Laden gespeicherter Zustände

    func testSavedGroupOrderIsRestored() {
        let cards = [
            EngineCard(phase: 1, status: .active, order: 0, groupPosition: 2),
            EngineCard(phase: 1, status: .active, order: 1, groupPosition: 0),
            EngineCard(phase: 1, status: .active, order: 2, groupPosition: 1)
        ]
        let engine = LearningEngine(cards: cards)
        XCTAssertEqual(orders(engine.activeGroup), [1, 2, 0])
    }

    func testRemovingCardRefillsGroup() {
        let engine = LearningEngine(cards: makeCards(6))
        let first = engine.currentCard!
        engine.removeCard(id: first.id)
        XCTAssertEqual(orders(engine.activeGroup), [1, 2, 3, 4, 5])
    }

    // MARK: - Vollständiger Durchlauf

    func testFullRunEndsWithAllCardsLearned() {
        let engine = LearningEngine(cards: makeCards(12))
        var steps = 0
        while engine.currentCard != nil && steps < 10_000 {
            // Jede dritte Antwort ist falsch, um Rückfälle mitzutesten.
            if steps % 3 == 2 { engine.rateUnknown() } else { engine.rateKnown() }
            XCTAssertLessThanOrEqual(engine.activeGroup.count, LearningEngine.groupSize)
            if let phase = engine.learningPhase {
                XCTAssertTrue(engine.activeGroup.allSatisfy { $0.phase == phase })
                XCTAssertEqual(phase, engine.cards.filter { $0.phase < 6 }.map(\.phase).min())
            }
            steps += 1
        }
        XCTAssertEqual(engine.learnedCount, 12)
        XCTAssertEqual(engine.progressPercent, 100)
    }
}
