import SwiftData
import XCTest
@testable import KarteiKarten

@MainActor
final class DeckTransferTests: XCTestCase {

    private func makeContext() throws -> ModelContext {
        let configuration = ModelConfiguration(isStoredInMemoryOnly: true)
        let container = try ModelContainer(for: Deck.self, Card.self, configurations: configuration)
        return ModelContext(container)
    }

    func testDecodeMinimalDeck() throws {
        let json = """
        { "name": "Test", "karten": [ { "frage": "F1", "antwort": "A1" } ] }
        """
        let transfer = try DeckTransfer.decode(from: Data(json.utf8))
        XCTAssertEqual(transfer.name, "Test")
        XCTAssertEqual(transfer.karten.count, 1)
        XCTAssertNil(transfer.karten[0].praxisbeispiel)
    }

    func testDecodeRejectsMissingAnswer() {
        let json = """
        { "name": "Test", "karten": [ { "frage": "F1" } ] }
        """
        XCTAssertThrowsError(try DeckTransfer.decode(from: Data(json.utf8)))
    }

    func testDecodeRejectsEmptyDeck() {
        let json = """
        { "name": "Test", "karten": [] }
        """
        XCTAssertThrowsError(try DeckTransfer.decode(from: Data(json.utf8))) { error in
            guard case DeckTransferError.noCards = error else { return XCTFail("Falscher Fehler: \(error)") }
        }
    }

    func testRoundTripKeepsAllFieldsAndPhases() throws {
        let context = try makeContext()
        let original = DeckTransfer(name: "Runde", karten: [
            CardTransfer(frage: "F1", antwort: "A1", praxisbeispiel: "P1", fallbeispiel: "Fall", loesung: "L", quelle: "Q", phase: 3),
            CardTransfer(frage: "F2", antwort: "A2", phase: nil)
        ])
        let deck = original.insert(into: context)
        XCTAssertEqual(deck.cards.count, 2)

        let exported = try DeckTransfer.decode(from: DeckTransfer(deck: deck).encoded())
        XCTAssertEqual(exported.name, "Runde")
        XCTAssertEqual(exported.karten[0].frage, "F1")
        XCTAssertEqual(exported.karten[0].fallbeispiel, "Fall")
        XCTAssertEqual(exported.karten[0].loesung, "L")
        XCTAssertEqual(exported.karten[0].quelle, "Q")
        XCTAssertEqual(exported.karten[0].phase, 3)
        XCTAssertEqual(exported.karten[1].phase, 1, "Ohne Angabe startet eine Karte in Phase 1")
    }

    func testImportedDeckHasActiveGroupOfFive() throws {
        let context = try makeContext()
        let transfer = DeckTransfer(name: "Viele", karten: (1...8).map {
            CardTransfer(frage: "F\($0)", antwort: "A\($0)")
        })
        let deck = transfer.insert(into: context)
        XCTAssertEqual(deck.cards.filter { $0.status == .active }.count, 5)
        XCTAssertEqual(deck.statistics.queueCount, 3)
    }

    func testSampleDeckIsValid() throws {
        let sample = try SampleDeck.load(bundle: Bundle(for: Deck.self))
        XCTAssertEqual(sample.name, "BWL/VWL Grundbegriffe")
        XCTAssertEqual(sample.karten.count, 15)
        XCTAssertTrue(sample.karten.allSatisfy { $0.praxisbeispiel != nil }, "Jede Karte hat ein Praxisbeispiel")
        let withCase = sample.karten.filter { $0.fallbeispiel != nil && $0.loesung != nil }
        XCTAssertGreaterThanOrEqual(withCase.count, 3)
    }

    func testStudySessionPersistsAfterEachAction() throws {
        let context = try makeContext()
        let transfer = DeckTransfer(name: "Sitzung", karten: (1...6).map {
            CardTransfer(frage: "F\($0)", antwort: "A\($0)")
        })
        let deck = transfer.insert(into: context)
        let session = StudySession(deck: deck, context: context)
        let first = try XCTUnwrap(session.currentCard)

        session.rateKnown()
        XCTAssertEqual(first.phase, 2)
        XCTAssertEqual(first.status, .queued)

        // Neue Sitzung (wie nach App-Neustart) sieht denselben Zustand.
        let reloaded = StudySession(deck: deck, context: context)
        XCTAssertEqual(reloaded.statistics.count(inPhase: 2), 1)
        XCTAssertNotEqual(reloaded.currentCard?.id, first.id)

        session.undo()
        XCTAssertEqual(first.phase, 1)
    }
}
