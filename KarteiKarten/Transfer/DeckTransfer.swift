import Foundation
import SwiftData
import SwiftUI
import UniformTypeIdentifiers

/// JSON-Format für Import und Export eines Stapels (siehe README).
///
/// ```json
/// {
///   "name": "Mein Stapel",
///   "karten": [
///     { "frage": "…", "antwort": "…", "praxisbeispiel": "…",
///       "fallbeispiel": "…", "loesung": "…", "quelle": "…", "phase": 1 }
///   ]
/// }
/// ```
struct DeckTransfer: Codable, Equatable {
    var format: String?
    var version: Int?
    var name: String
    var karten: [CardTransfer]

    static let formatName = "karteikarten-stapel"
    static let currentVersion = 1

    init(name: String, karten: [CardTransfer]) {
        self.format = Self.formatName
        self.version = Self.currentVersion
        self.name = name
        self.karten = karten
    }
}

struct CardTransfer: Codable, Equatable {
    var frage: String
    var antwort: String
    var praxisbeispiel: String?
    var fallbeispiel: String?
    var loesung: String?
    var quelle: String?
    /// Optional: Lernphase 1–6 (Standard beim Import: 1).
    var phase: Int?
}

enum DeckTransferError: LocalizedError {
    case unreadable
    case invalidJSON(String)
    case noCards

    var errorDescription: String? {
        switch self {
        case .unreadable:
            return "Die Datei konnte nicht gelesen werden."
        case .invalidJSON(let detail):
            return "Die Datei ist kein gültiger Stapel im JSON-Format.\n\(detail)"
        case .noCards:
            return "Der Stapel enthält keine Karten mit Frage und Antwort."
        }
    }
}

extension DeckTransfer {
    // MARK: Lesen

    static func decode(from data: Data) throws -> DeckTransfer {
        do {
            var transfer = try JSONDecoder().decode(DeckTransfer.self, from: data)
            transfer.name = transfer.name.trimmingCharacters(in: .whitespacesAndNewlines)
            if transfer.name.isEmpty { transfer.name = "Importierter Stapel" }
            transfer.karten = transfer.karten.filter {
                !$0.frage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                !$0.antwort.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
            guard !transfer.karten.isEmpty else { throw DeckTransferError.noCards }
            return transfer
        } catch let error as DeckTransferError {
            throw error
        } catch let DecodingError.keyNotFound(key, context) {
            throw DeckTransferError.invalidJSON("Es fehlt das Feld „\(key.stringValue)“ \(Self.location(context)).")
        } catch let DecodingError.typeMismatch(_, context) {
            throw DeckTransferError.invalidJSON("Falscher Datentyp \(Self.location(context)).")
        } catch let DecodingError.valueNotFound(_, context) {
            throw DeckTransferError.invalidJSON("Fehlender Wert \(Self.location(context)).")
        } catch {
            throw DeckTransferError.invalidJSON("Bitte prüfe Klammern, Kommas und Anführungszeichen.")
        }
    }

    private static func location(_ context: DecodingError.Context) -> String {
        let path = context.codingPath.map { key -> String in
            if let index = key.intValue { return "Karte \(index + 1)" }
            return key.stringValue
        }
        return path.isEmpty ? "" : "(bei: \(path.joined(separator: " → ")))"
    }

    /// Legt den Stapel in der Datenbank an.
    @discardableResult
    func insert(into context: ModelContext) -> Deck {
        let deck = Deck(name: name)
        context.insert(deck)
        for (index, item) in karten.enumerated() {
            let card = Card(
                question: item.frage.trimmingCharacters(in: .whitespacesAndNewlines),
                answer: item.antwort.trimmingCharacters(in: .whitespacesAndNewlines),
                practiceExample: item.praxisbeispiel,
                caseStudy: item.fallbeispiel,
                caseSolution: item.loesung,
                source: item.quelle,
                phase: item.phase ?? 1,
                order: index
            )
            context.insert(card)
            deck.cards.append(card)
        }
        deck.normalizeLearningState()
        try? context.save()
        return deck
    }

    // MARK: Schreiben

    init(deck: Deck) {
        self.init(
            name: deck.name,
            karten: deck.sortedCards.map {
                CardTransfer(
                    frage: $0.question,
                    antwort: $0.answer,
                    praxisbeispiel: $0.practiceExample,
                    fallbeispiel: $0.caseStudy,
                    loesung: $0.caseSolution,
                    quelle: $0.source,
                    phase: $0.phase
                )
            }
        )
    }

    func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }
}

/// Datei-Hülle für den Export über die Dateien-App.
struct DeckFileDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }

    var data: Data

    init(data: Data) { self.data = data }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents else {
            throw DeckTransferError.unreadable
        }
        self.data = data
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

enum DeckImporter {
    /// Liest eine vom Benutzer ausgewählte Datei (Dateien-App) und legt den Stapel an.
    @discardableResult
    static func importDeck(from url: URL, into context: ModelContext) throws -> Deck {
        let accessing = url.startAccessingSecurityScopedResource()
        defer { if accessing { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { throw DeckTransferError.unreadable }
        return try DeckTransfer.decode(from: data).insert(into: context)
    }
}

extension String {
    /// Dateiname ohne problematische Zeichen.
    var safeFileName: String {
        let invalid = CharacterSet(charactersIn: "/\\?%*|\"<>:")
        let cleaned = components(separatedBy: invalid).joined(separator: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "Stapel" : cleaned
    }
}
