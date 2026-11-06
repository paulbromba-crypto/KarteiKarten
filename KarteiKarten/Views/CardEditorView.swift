import SwiftData
import SwiftUI

/// Karte anlegen oder bearbeiten.
struct CardEditorView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    let deck: Deck
    let card: Card?

    @State private var question = ""
    @State private var answer = ""
    @State private var practiceExample = ""
    @State private var caseStudy = ""
    @State private var caseSolution = ""
    @State private var source = ""
    @State private var showingDeleteConfirmation = false

    init(deck: Deck, card: Card?) {
        self.deck = deck
        self.card = card
        _question = State(initialValue: card?.question ?? "")
        _answer = State(initialValue: card?.answer ?? "")
        _practiceExample = State(initialValue: card?.practiceExample ?? "")
        _caseStudy = State(initialValue: card?.caseStudy ?? "")
        _caseSolution = State(initialValue: card?.caseSolution ?? "")
        _source = State(initialValue: card?.source ?? "")
    }

    private var isValid: Bool {
        !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Frage") {
                    TextField("z. B. Opportunitätskosten", text: $question, axis: .vertical)
                        .lineLimit(2...6)
                }
                Section("Antwort") {
                    TextField("Definition / Erklärung", text: $answer, axis: .vertical)
                        .lineLimit(3...12)
                }
                Section {
                    TextField("Kurzes Beispiel aus der Praxis", text: $practiceExample, axis: .vertical)
                        .lineLimit(2...8)
                } header: {
                    Text("Praxisbeispiel (optional)")
                }
                Section {
                    TextField("Kurzer Praxisfall mit Aufgabe", text: $caseStudy, axis: .vertical)
                        .lineLimit(2...10)
                    TextField("Lösung zum Fallbeispiel", text: $caseSolution, axis: .vertical)
                        .lineLimit(2...10)
                } header: {
                    Text("Fallbeispiel (optional)")
                }
                Section("Quelle (optional)") {
                    TextField("z. B. Lehrbuch, Seite", text: $source, axis: .vertical)
                        .lineLimit(1...3)
                }

                if let card {
                    Section {
                        LabeledContent("Aktuelle Phase", value: card.phase == 6 ? "6 (gelernt)" : "\(card.phase)")
                        Button("Karte löschen", role: .destructive) {
                            showingDeleteConfirmation = true
                        }
                    }
                }
            }
            .navigationTitle(card == nil ? "Neue Karte" : "Karte bearbeiten")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Abbrechen") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Sichern") { save() }
                        .disabled(!isValid)
                }
            }
            .confirmationDialog("Karte löschen?", isPresented: $showingDeleteConfirmation, titleVisibility: .visible) {
                Button("Löschen", role: .destructive) { deleteCard() }
            }
        }
    }

    private func save() {
        let trimmedQuestion = question.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedAnswer = answer.trimmingCharacters(in: .whitespacesAndNewlines)

        if let card {
            card.question = trimmedQuestion
            card.answer = trimmedAnswer
            card.practiceExample = Optional(practiceExample).nonEmpty
            card.caseStudy = Optional(caseStudy).nonEmpty
            card.caseSolution = Optional(caseSolution).nonEmpty
            card.source = Optional(source).nonEmpty
        } else {
            let newCard = Card(
                question: trimmedQuestion,
                answer: trimmedAnswer,
                practiceExample: practiceExample,
                caseStudy: caseStudy,
                caseSolution: caseSolution,
                source: source,
                order: deck.nextOrder
            )
            context.insert(newCard)
            deck.cards.append(newCard)
            deck.normalizeLearningState()
        }
        try? context.save()
        dismiss()
    }

    private func deleteCard() {
        guard let card else { return }
        deck.cards.removeAll { $0.id == card.id }
        context.delete(card)
        deck.normalizeLearningState()
        try? context.save()
        dismiss()
    }
}
