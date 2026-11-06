import Foundation
import SwiftData

/// Legt beim allerersten Start den Beispielstapel „BWL/VWL Grundbegriffe“ an.
enum SampleDeck {
    static let resourceName = "BWL-VWL-Grundbegriffe"
    private static let seededKey = "didSeedSampleDeck"

    static func load(bundle: Bundle = .main) throws -> DeckTransfer {
        guard let url = bundle.url(forResource: resourceName, withExtension: "json") else {
            throw DeckTransferError.unreadable
        }
        return try DeckTransfer.decode(from: Data(contentsOf: url))
    }

    static func seedIfNeeded(context: ModelContext, defaults: UserDefaults = .standard) {
        guard !defaults.bool(forKey: seededKey) else { return }
        defer { defaults.set(true, forKey: seededKey) }

        // Falls bereits Stapel existieren (z. B. nach einer Neuinstallation mit Daten), nichts tun.
        let existing = (try? context.fetchCount(FetchDescriptor<Deck>())) ?? 0
        guard existing == 0 else { return }

        do {
            try load().insert(into: context)
        } catch {
            print("Beispielstapel konnte nicht geladen werden: \(error)")
        }
    }
}
