import SwiftData
import SwiftUI
import UniformTypeIdentifiers

/// Startbildschirm: alle Stapel.
struct DeckListView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Deck.createdAt) private var decks: [Deck]

    @State private var showingNewDeck = false
    @State private var newDeckName = ""
    @State private var showingImporter = false
    @State private var importMessage: ImportMessage?
    @State private var deckToDelete: Deck?

    var body: some View {
        NavigationStack {
            Group {
                if decks.isEmpty {
                    ContentUnavailableView {
                        Label("Keine Stapel", systemImage: "rectangle.stack")
                    } description: {
                        Text("Lege einen neuen Stapel an oder importiere eine JSON-Datei.")
                    } actions: {
                        Button("Neuer Stapel") { showingNewDeck = true }
                            .buttonStyle(.borderedProminent)
                        Button("Stapel importieren") { showingImporter = true }
                    }
                } else {
                    List {
                        ForEach(decks) { deck in
                            NavigationLink(value: deck) {
                                DeckRow(deck: deck)
                            }
                            .swipeActions {
                                Button("Löschen", role: .destructive) { deckToDelete = deck }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Karteikarten")
            .navigationDestination(for: Deck.self) { deck in
                DeckDetailView(deck: deck)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showingImporter = true
                    } label: {
                        Label("Importieren", systemImage: "square.and.arrow.down")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        newDeckName = ""
                        showingNewDeck = true
                    } label: {
                        Label("Neuer Stapel", systemImage: "plus")
                    }
                }
            }
            .alert("Neuer Stapel", isPresented: $showingNewDeck) {
                TextField("Name", text: $newDeckName)
                Button("Abbrechen", role: .cancel) {}
                Button("Anlegen") { createDeck() }
            }
            .fileImporter(isPresented: $showingImporter, allowedContentTypes: [.json, .plainText, .data]) { result in
                handleImport(result)
            }
            .alert(item: $importMessage) { message in
                Alert(title: Text(message.title), message: Text(message.text), dismissButton: .default(Text("OK")))
            }
            .confirmationDialog(
                "Stapel löschen?",
                isPresented: Binding(get: { deckToDelete != nil }, set: { if !$0 { deckToDelete = nil } }),
                titleVisibility: .visible,
                presenting: deckToDelete
            ) { deck in
                Button("„\(deck.name)“ löschen", role: .destructive) {
                    context.delete(deck)
                    try? context.save()
                }
            } message: { deck in
                Text("Alle \(deck.cards.count) Karten und der Lernfortschritt gehen verloren.")
            }
            .task {
                SampleDeck.seedIfNeeded(context: context)
            }
        }
    }

    private func createDeck() {
        let name = newDeckName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        context.insert(Deck(name: name))
        try? context.save()
    }

    private func handleImport(_ result: Result<URL, Error>) {
        switch result {
        case .success(let url):
            do {
                let deck = try DeckImporter.importDeck(from: url, into: context)
                importMessage = ImportMessage(
                    title: "Import erfolgreich",
                    text: "Der Stapel „\(deck.name)“ mit \(deck.cards.count) Karten wurde angelegt."
                )
            } catch {
                importMessage = ImportMessage(title: "Import fehlgeschlagen", text: error.localizedDescription)
            }
        case .failure(let error):
            importMessage = ImportMessage(title: "Import fehlgeschlagen", text: error.localizedDescription)
        }
    }
}

struct ImportMessage: Identifiable {
    let id = UUID()
    let title: String
    let text: String
}

private struct DeckRow: View {
    let deck: Deck

    var body: some View {
        let stats = deck.statistics
        VStack(alignment: .leading, spacing: 8) {
            Text(deck.name)
                .font(.headline)
            HStack {
                Text("\(stats.total) Karten")
                Spacer()
                Text("\(Int(stats.progressPercent.rounded())) % gelernt")
                    .monospacedDigit()
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            ProgressView(value: stats.progressPercent, total: 100)
                .tint(Theme.color(forPhase: 6))
        }
        .padding(.vertical, 6)
    }
}
