import SwiftData
import SwiftUI

/// Lernbildschirm mit Karte und großen Bewertungs-Buttons.
struct StudyView: View {
    @State private var session: StudySession
    @State private var showingResetConfirmation = false
    /// Richtung der letzten Aktion – steuert die Übergangsanimation.
    @State private var lastAction: LastAction = .none

    enum LastAction { case none, known, unknown, skip, undo }

    init(deck: Deck, phaseFilter: Int?, context: ModelContext) {
        _session = State(initialValue: StudySession(deck: deck, context: context, phaseFilter: phaseFilter))
    }

    var body: some View {
        VStack(spacing: 16) {
            header
            cardArea
            controls
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .background(Color(.systemGroupedBackground).ignoresSafeArea())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Phase", selection: Binding(
                        get: { session.phaseFilter ?? 0 },
                        set: { session.setPhaseFilter($0 == 0 ? nil : $0) }
                    )) {
                        Text("Alle Phasen (automatisch)").tag(0)
                        ForEach(1..<6) { phase in
                            Text("Nur Phase \(phase) (\(session.statistics.count(inPhase: phase)))").tag(phase)
                        }
                    }
                    Divider()
                    Button(role: .destructive) {
                        showingResetConfirmation = true
                    } label: {
                        Label("Zurücksetzen", systemImage: "arrow.counterclockwise")
                    }
                } label: {
                    Label("Optionen", systemImage: "line.3.horizontal.decrease.circle")
                }
            }
        }
        .confirmationDialog("Stapel zurücksetzen?", isPresented: $showingResetConfirmation, titleVisibility: .visible) {
            Button("Alle Karten auf Phase 1 setzen", role: .destructive) {
                withAnimation { session.reset() }
            }
        } message: {
            Text("Der gesamte Lernfortschritt dieses Stapels geht verloren.")
        }
    }

    private var title: String {
        if let filter = session.phaseFilter { return "Nur Phase \(filter)" }
        return session.deck.name
    }

    // MARK: - Kopfbereich

    private var header: some View {
        VStack(spacing: 10) {
            ProgressBarView(percent: session.statistics.progressPercent)
            HStack(spacing: 8) {
                if let phase = session.learningPhase {
                    PhaseBadge(phase: phase)
                }
                Text("Gruppe \(session.groupCount)/\(LearningEngine.groupSize)")
                Spacer()
                Text("Warteschlange: \(session.statistics.queueCount)")
            }
            .font(.footnote.monospacedDigit())
            .foregroundStyle(.secondary)
        }
        .padding(.top, 8)
    }

    // MARK: - Karte

    @ViewBuilder
    private var cardArea: some View {
        if let card = session.currentCard {
            FlashcardView(card: card)
                .id("\(card.id)-\(session.revision)")
                .transition(cardTransition)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            emptyState
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var cardTransition: AnyTransition {
        switch lastAction {
        case .known:
            return .asymmetric(insertion: .opacity.combined(with: .scale(scale: 0.95)),
                               removal: .move(edge: .trailing).combined(with: .opacity))
        case .unknown, .skip:
            return .asymmetric(insertion: .opacity.combined(with: .scale(scale: 0.95)),
                               removal: .move(edge: .leading).combined(with: .opacity))
        case .undo, .none:
            return .opacity
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        if session.statistics.total == 0 {
            ContentUnavailableView(
                "Keine Karten",
                systemImage: "rectangle.on.rectangle.slash",
                description: Text("Lege zuerst Karten in diesem Stapel an.")
            )
        } else if let filter = session.phaseFilter {
            ContentUnavailableView {
                Label("Phase \(filter) ist leer", systemImage: "checkmark.circle")
            } description: {
                Text("In dieser Phase gibt es gerade keine Karten.")
            } actions: {
                Button("Alle Phasen lernen") { session.setPhaseFilter(nil) }
                    .buttonStyle(.borderedProminent)
            }
        } else {
            ContentUnavailableView(
                "Alles gelernt! 🎉",
                systemImage: "checkmark.seal.fill",
                description: Text("Alle Karten haben Phase 6 erreicht. Über „Zurücksetzen“ kannst du von vorn beginnen.")
            )
        }
    }

    // MARK: - Buttons

    private var controls: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Button {
                    perform(.unknown) { session.rateUnknown() }
                } label: {
                    Label("Kann ich nicht", systemImage: "xmark")
                }
                .buttonStyle(BigButtonStyle(color: Theme.unknown))

                Button {
                    perform(.known) { session.rateKnown() }
                } label: {
                    Label("Kann ich", systemImage: "checkmark")
                }
                .buttonStyle(BigButtonStyle(color: Theme.known))
            }
            .disabled(session.currentCard == nil)

            HStack(spacing: 10) {
                Button {
                    perform(.undo) { session.undo() }
                } label: {
                    Label("Rückgängig", systemImage: "arrow.uturn.backward")
                }
                .buttonStyle(BigButtonStyle(color: .accentColor, filled: false))
                .disabled(!session.canUndo)
                .opacity(session.canUndo ? 1 : 0.5)

                Button {
                    perform(.skip) { session.skip() }
                } label: {
                    Label("Überspringen", systemImage: "forward")
                }
                .buttonStyle(BigButtonStyle(color: .accentColor, filled: false))
                .disabled(!session.canSkip)
                .opacity(session.canSkip ? 1 : 0.5)
            }
        }
        .labelStyle(.titleAndIcon)
    }

    private func perform(_ action: LastAction, _ work: () -> Void) {
        lastAction = action
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
        withAnimation(.easeInOut(duration: 0.3)) { work() }
    }
}

struct PhaseBadge: View {
    let phase: Int

    var body: some View {
        Text(phase == 6 ? "Gelernt" : "Phase \(phase)")
            .font(.caption.weight(.bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Capsule().fill(Theme.color(forPhase: phase)))
    }
}
