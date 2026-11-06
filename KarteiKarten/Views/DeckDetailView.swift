import SwiftData
import SwiftUI

/// Ziel für das Lernen: alle Phasen oder gezielt eine Phase.
struct StudyTarget: Hashable, Identifiable {
    var phase: Int?
    var id: Int { phase ?? 0 }
}

/// Übersicht eines Stapels mit Statistik, Lernstart und Kartenliste.
struct DeckDetailView: View {
    @Environment(\.modelContext) private var context
    @Bindable var deck: Deck

    @State private var studyTarget: StudyTarget?
    @State private var editingCard: Card?
    @State private var showingNewCard = false
    @State private var showingResetConfirmation = false
    @State private var showingRename = false
    @State private var renameText = ""
    @State private var exportDocument: DeckFileDocument?
    @State private var showingExporter = false
    @State private var exportMessage: ImportMessage?

    var body: some View {
        let stats = deck.statistics
        List {
            Section {
                VStack(alignment: .leading, spacing: 16) {
                    ProgressBarView(percent: stats.progressPercent)
                    Text("\(stats.learned) von \(stats.total) Karten gelernt")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 6)

                Button {
                    studyTarget = StudyTarget(phase: nil)
                } label: {
                    Label("Lernen starten", systemImage: "play.fill")
                }
                .buttonStyle(BigButtonStyle(color: .accentColor))
                .disabled(stats.total == stats.learned)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            }

            Section {
                PhaseOverviewView(statistics: stats) { phase in
                    studyTarget = StudyTarget(phase: phase)
                }
                .listRowInsets(EdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12))
                .listRowBackground(Color.clear)
            } header: {
                Text("Übersicht")
            } footer: {
                Text("Tippe auf eine Phase, um gezielt nur deren Karten zu lernen.")
            }

            Section("Karten (\(deck.cards.count))") {
                if deck.cards.isEmpty {
                    Text("Noch keine Karten. Tippe auf „+“, um eine Karte anzulegen.")
                        .foregroundStyle(.secondary)
                }
                ForEach(deck.sortedCards) { card in
                    Button {
                        editingCard = card
                    } label: {
                        CardRow(card: card)
                    }
                    .buttonStyle(.plain)
                    .swipeActions {
                        Button("Löschen", role: .destructive) { delete(card) }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(deck.name)
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showingNewCard = true
                } label: {
                    Label("Neue Karte", systemImage: "plus")
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Menu {
                        ForEach(1..<6) { phase in
                            Button("Phase \(phase) (\(stats.count(inPhase: phase)) Karten)") {
                                studyTarget = StudyTarget(phase: phase)
                            }
                            .disabled(stats.count(inPhase: phase) == 0)
                        }
                    } label: {
                        Label("Bestimmte Phase lernen", systemImage: "line.3.horizontal.decrease.circle")
                    }
                    Button {
                        renameText = deck.name
                        showingRename = true
                    } label: {
                        Label("Umbenennen", systemImage: "pencil")
                    }
                    Button {
                        export()
                    } label: {
                        Label("Als JSON exportieren", systemImage: "square.and.arrow.up")
                    }
                    Divider()
                    Button(role: .destructive) {
                        showingResetConfirmation = true
                    } label: {
                        Label("Zurücksetzen", systemImage: "arrow.counterclockwise")
                    }
                } label: {
                    Label("Mehr", systemImage: "ellipsis.circle")
                }
            }
        }
        .navigationDestination(item: $studyTarget) { target in
            StudyView(deck: deck, phaseFilter: target.phase, context: context)
        }
        .sheet(isPresented: $showingNewCard) {
            CardEditorView(deck: deck, card: nil)
        }
        .sheet(item: $editingCard) { card in
            CardEditorView(deck: deck, card: card)
        }
        .confirmationDialog("Stapel zurücksetzen?", isPresented: $showingResetConfirmation, titleVisibility: .visible) {
            Button("Alle Karten auf Phase 1 setzen", role: .destructive) {
                deck.resetProgress()
                try? context.save()
            }
        } message: {
            Text("Der gesamte Lernfortschritt dieses Stapels geht verloren.")
        }
        .alert("Stapel umbenennen", isPresented: $showingRename) {
            TextField("Name", text: $renameText)
            Button("Abbrechen", role: .cancel) {}
            Button("Speichern") {
                let name = renameText.trimmingCharacters(in: .whitespacesAndNewlines)
                if !name.isEmpty {
                    deck.name = name
                    try? context.save()
                }
            }
        }
        .fileExporter(
            isPresented: $showingExporter,
            document: exportDocument,
            contentType: .json,
            defaultFilename: deck.name.safeFileName
        ) { result in
            if case .failure(let error) = result {
                exportMessage = ImportMessage(title: "Export fehlgeschlagen", text: error.localizedDescription)
            }
        }
        .alert(item: $exportMessage) { message in
            Alert(title: Text(message.title), message: Text(message.text), dismissButton: .default(Text("OK")))
        }
    }

    private func delete(_ card: Card) {
        deck.cards.removeAll { $0.id == card.id }
        context.delete(card)
        deck.normalizeLearningState()
        try? context.save()
    }

    private func export() {
        do {
            exportDocument = DeckFileDocument(data: try DeckTransfer(deck: deck).encoded())
            showingExporter = true
        } catch {
            exportMessage = ImportMessage(title: "Export fehlgeschlagen", text: error.localizedDescription)
        }
    }
}

private struct CardRow: View {
    let card: Card

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(card.phase == 6 ? "✓" : "\(card.phase)")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(Circle().fill(Theme.color(forPhase: card.phase)))
                .accessibilityLabel(card.phase == 6 ? "Gelernt" : "Phase \(card.phase)")
            VStack(alignment: .leading, spacing: 4) {
                Text(card.question)
                    .font(.body)
                    .lineLimit(2)
                Text(card.answer)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                if card.caseStudy != nil {
                    Label("Fallbeispiel", systemImage: "briefcase")
                        .font(.caption)
                        .foregroundStyle(Theme.caseStudy)
                }
            }
            Spacer(minLength: 0)
        }
        .contentShape(Rectangle())
        .padding(.vertical, 4)
    }
}
