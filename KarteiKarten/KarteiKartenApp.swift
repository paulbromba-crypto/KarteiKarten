import SwiftData
import SwiftUI

@main
struct KarteiKartenApp: App {
    var body: some Scene {
        WindowGroup {
            DeckListView()
        }
        .modelContainer(for: [Deck.self, Card.self])
    }
}
