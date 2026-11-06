import Foundation

/// Status einer Karte im Lernsystem.
enum CardStatus: String, Codable, CaseIterable {
    /// Wartet darauf, in die aktive Lerngruppe aufgenommen zu werden.
    case queued
    /// Ist Teil der aktuellen 5er-Lerngruppe.
    case active
    /// Hat Phase 6 erreicht und wird nicht mehr abgefragt.
    case learned
}

/// Reiner Lernzustand einer Karte – unabhängig von SwiftData, damit die
/// Lernlogik ohne Datenbank getestet werden kann.
struct EngineCard: Equatable, Identifiable {
    let id: UUID
    var phase: Int
    var status: CardStatus
    /// Erstellungsreihenfolge (kleiner = früher angelegt).
    var order: Int
    /// Position innerhalb der aktiven Lerngruppe (nur bei `.active` relevant).
    var groupPosition: Int

    init(id: UUID = UUID(), phase: Int = 1, status: CardStatus = .queued, order: Int, groupPosition: Int = 0) {
        self.id = id
        self.phase = phase
        self.status = status
        self.order = order
        self.groupPosition = groupPosition
    }
}

/// Das Phasensystem (ähnlich Leitner) mit 5er-Lerngruppe.
///
/// Regeln:
/// - Neue Karten starten in Phase 1. „Kann ich“ → Phase +1, „Kann ich nicht“ → Phase −1 (min. 1, max. 6).
/// - Phase 6 = gelernt, die Karte wird nicht mehr abgefragt.
/// - Es wird immer die niedrigste noch nicht abgeschlossene Phase gelernt.
/// - Höchstens 5 Karten sind gleichzeitig aktiv; die Gruppe wird nur aus Karten
///   dieser Phase gefüllt (in Erstellungsreihenfolge).
/// - „Kann ich nicht“: Karte bleibt in der Gruppe und kommt später in derselben Runde wieder.
/// - „Kann ich“: Karte steigt auf, verlässt die Gruppe und macht Platz für die nächste Karte.
/// - Fällt eine Karte in eine niedrigere Phase zurück, hat diese Phase sofort wieder Vorrang.
final class LearningEngine {
    static let minPhase = 1
    static let maxPhase = 6
    static let groupSize = 5

    /// Alle Karten, sortiert nach Erstellungsreihenfolge.
    private(set) var cards: [EngineCard]

    /// Schnappschüsse für das mehrstufige „Rückgängig“.
    private var undoStack: [[EngineCard]] = []

    /// Optional: nur Karten einer bestimmten Phase (1–5) lernen.
    /// `nil` = normales Lernen der niedrigsten offenen Phase.
    var phaseFilter: Int? {
        didSet {
            if let filter = phaseFilter, !(Self.minPhase..<Self.maxPhase).contains(filter) {
                phaseFilter = nil
            }
            if oldValue != phaseFilter { normalize() }
        }
    }

    init(cards: [EngineCard], phaseFilter: Int? = nil) {
        self.cards = cards.sorted { $0.order < $1.order }
        if let filter = phaseFilter, (Self.minPhase..<Self.maxPhase).contains(filter) {
            self.phaseFilter = filter
        }
        normalize()
    }

    // MARK: - Abfragen

    /// Die Phase, die gerade gelernt wird (`nil`, wenn nichts mehr zu lernen ist).
    var learningPhase: Int? {
        if let filter = phaseFilter {
            return cards.contains { $0.phase == filter } ? filter : nil
        }
        return cards.filter { $0.phase < Self.maxPhase }.map(\.phase).min()
    }

    /// Die aktive Lerngruppe in Abfragereihenfolge.
    var activeGroup: [EngineCard] {
        cards.filter { $0.status == .active }.sorted { $0.groupPosition < $1.groupPosition }
    }

    /// Die Karte, die gerade abgefragt wird.
    var currentCard: EngineCard? { activeGroup.first }

    /// Anzahl Karten in einer Phase (1–6).
    func count(inPhase phase: Int) -> Int {
        cards.filter { $0.phase == phase }.count
    }

    /// Anzahl Karten in der Warteschlange (weder aktiv noch gelernt).
    var queueCount: Int { cards.filter { $0.status == .queued }.count }

    /// Anzahl gelernter Karten (Phase 6).
    var learnedCount: Int { count(inPhase: Self.maxPhase) }

    /// Lernfortschritt in Prozent: Karten in Phase 6 ÷ Gesamtkarten × 100.
    var progressPercent: Double {
        guard !cards.isEmpty else { return 0 }
        return Double(learnedCount) / Double(cards.count) * 100
    }

    var canUndo: Bool { !undoStack.isEmpty }

    func card(id: UUID) -> EngineCard? { cards.first { $0.id == id } }

    // MARK: - Aktionen

    /// „Kann ich“: aktuelle Karte steigt eine Phase auf und verlässt die Gruppe.
    @discardableResult
    func rateKnown() -> Bool {
        guard let current = currentCard, let index = index(of: current.id) else { return false }
        pushUndo()
        let newPhase = min(cards[index].phase + 1, Self.maxPhase)
        cards[index].phase = newPhase
        cards[index].status = newPhase == Self.maxPhase ? .learned : .queued
        cards[index].groupPosition = 0
        normalize()
        return true
    }

    /// „Kann ich nicht“: aktuelle Karte fällt eine Phase zurück, bleibt in der
    /// Gruppe und wird ans Ende der Runde gestellt.
    @discardableResult
    func rateUnknown() -> Bool {
        guard let current = currentCard, let index = index(of: current.id) else { return false }
        pushUndo()
        cards[index].phase = max(cards[index].phase - 1, Self.minPhase)
        cards[index].groupPosition = nextGroupPosition()
        normalize()
        return true
    }

    /// „Überspringen“: aktuelle Karte ans Ende der Gruppe, ohne Bewertung.
    @discardableResult
    func skip() -> Bool {
        guard let current = currentCard, let index = index(of: current.id) else { return false }
        guard activeGroup.count > 1 else { return false }
        cards[index].groupPosition = nextGroupPosition()
        normalize()
        return true
    }

    /// „Rückgängig“: nimmt die letzte Bewertung vollständig zurück (mehrstufig).
    @discardableResult
    func undo() -> Bool {
        guard let snapshot = undoStack.popLast() else { return false }
        cards = snapshot
        normalize()
        return true
    }

    /// „Zurücksetzen“: alle Karten zurück auf Phase 1.
    func reset() {
        for index in cards.indices {
            cards[index].phase = Self.minPhase
            cards[index].status = .queued
            cards[index].groupPosition = 0
        }
        undoStack.removeAll()
        normalize()
    }

    /// Fügt eine neue Karte hinzu (startet in Phase 1 am Ende der Reihenfolge).
    @discardableResult
    func addCard(id: UUID = UUID()) -> EngineCard {
        let order = (cards.map(\.order).max() ?? -1) + 1
        let card = EngineCard(id: id, phase: Self.minPhase, status: .queued, order: order)
        cards.append(card)
        normalize()
        return self.card(id: id) ?? card
    }

    /// Entfernt eine Karte.
    func removeCard(id: UUID) {
        cards.removeAll { $0.id == id }
        undoStack = undoStack.map { $0.filter { $0.id != id } }
        normalize()
    }

    // MARK: - Interna

    private func index(of id: UUID) -> Int? { cards.firstIndex { $0.id == id } }

    private func pushUndo() { undoStack.append(cards) }

    private func nextGroupPosition() -> Int {
        (cards.filter { $0.status == .active }.map(\.groupPosition).max() ?? -1) + 1
    }

    /// Stellt alle Regeln her: gültige Phasen, passender Status, Gruppe nur aus
    /// der Lernphase, Gruppe auf maximal 5 Karten auffüllen.
    private func normalize() {
        // 1. Phasen begrenzen und Status „gelernt“ konsistent halten.
        for index in cards.indices {
            cards[index].phase = min(max(cards[index].phase, Self.minPhase), Self.maxPhase)
            if cards[index].phase == Self.maxPhase {
                cards[index].status = .learned
            } else if cards[index].status == .learned {
                cards[index].status = .queued
            }
        }

        // 2. Karten, die nicht (mehr) zur Lernphase gehören, verlassen die Gruppe.
        let target = learningPhase
        for index in cards.indices where cards[index].status == .active && cards[index].phase != target {
            cards[index].status = .queued
            cards[index].groupPosition = 0
        }

        // 3. Zu große Gruppen (z. B. aus alten Daten) kürzen.
        var group = activeGroup
        if group.count > Self.groupSize {
            for extra in group[Self.groupSize...] {
                if let index = index(of: extra.id) {
                    cards[index].status = .queued
                    cards[index].groupPosition = 0
                }
            }
            group = Array(group.prefix(Self.groupSize))
        }

        // 4. Gruppe aus der Warteschlange der Lernphase auffüllen (Erstellungsreihenfolge).
        if let target, group.count < Self.groupSize {
            let candidates = cards
                .filter { $0.status == .queued && $0.phase == target }
                .sorted { $0.order < $1.order }
                .prefix(Self.groupSize - group.count)
            group.append(contentsOf: candidates)
        }

        // 5. Positionen lückenlos neu vergeben.
        for (position, member) in group.enumerated() {
            if let index = index(of: member.id) {
                cards[index].status = .active
                cards[index].groupPosition = position
            }
        }
    }
}
