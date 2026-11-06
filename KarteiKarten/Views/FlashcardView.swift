import SwiftUI

/// Karteikarte: Antippen dreht die Karte um (Vorderseite Frage, Rückseite Antwort).
struct FlashcardView: View {
    let card: Card
    @State private var isFlipped = false

    var body: some View {
        let angle = isFlipped ? 180.0 : 0.0
        ZStack {
            front
                .modifier(FlipVisibility(angle: angle, visibleOnFront: true))
            back
                .rotation3DEffect(.degrees(180), axis: (x: 0, y: 1, z: 0))
                .modifier(FlipVisibility(angle: angle, visibleOnFront: false))
        }
        .rotation3DEffect(.degrees(angle), axis: (x: 0, y: 1, z: 0), perspective: 0.4)
        .animation(.spring(response: 0.5, dampingFraction: 0.82), value: isFlipped)
        .contentShape(Rectangle())
        .onTapGesture { isFlipped.toggle() }
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(isFlipped ? "Tippen, um die Frage zu sehen" : "Tippen, um die Antwort zu sehen")
    }

    // MARK: Vorderseite

    private var front: some View {
        CardFace {
            VStack(spacing: 16) {
                HStack {
                    PhaseBadge(phase: card.phase)
                    Spacer()
                    Text("Frage")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                GeometryReader { geometry in
                    ScrollView {
                        Text(card.question)
                            .font(.title2.weight(.semibold))
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity, minHeight: geometry.size.height)
                    }
                    .scrollBounceBehavior(.basedOnSize)
                }
                Label("Zum Umdrehen tippen", systemImage: "hand.tap")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: Rückseite

    private var back: some View {
        CardFace {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text(card.question)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                    Spacer()
                    Text("Antwort")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                Divider()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text(card.answer)
                            .font(.body)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        if let example = card.practiceExample {
                            InfoBox(title: "Praxisbeispiel", systemImage: "lightbulb", color: .blue, text: example)
                        }

                        if let caseStudy = card.caseStudy {
                            CaseStudyBox(caseStudy: caseStudy, solution: card.caseSolution)
                        }

                        if let source = card.source {
                            Label(source, systemImage: "book.closed")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.bottom, 8)
                }
            }
        }
    }
}

/// Blendet eine Seite je nach Drehwinkel ein/aus (genau bei 90°).
private struct FlipVisibility: ViewModifier, Animatable {
    var angle: Double
    let visibleOnFront: Bool

    var animatableData: Double {
        get { angle }
        set { angle = newValue }
    }

    func body(content: Content) -> some View {
        let showingFront = angle < 90
        content
            .opacity(showingFront == visibleOnFront ? 1 : 0)
            .allowsHitTesting(showingFront == visibleOnFront)
            .accessibilityHidden(showingFront != visibleOnFront)
    }
}

/// Gemeinsames Aussehen beider Kartenseiten.
private struct CardFace<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(
                RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous)
                    .fill(Color(.secondarySystemGroupedBackground))
                    .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.06))
            )
    }
}

private struct InfoBox: View {
    let title: String
    let systemImage: String
    let color: Color
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(color)
            Text(text)
                .font(.callout)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(color.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// Optisch abgesetztes Fallbeispiel mit aufklappbarer Lösung.
private struct CaseStudyBox: View {
    let caseStudy: String
    let solution: String?
    @State private var showingSolution = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Fallbeispiel", systemImage: "briefcase.fill")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(Theme.caseStudy)
            Text(caseStudy)
                .font(.callout)
                .frame(maxWidth: .infinity, alignment: .leading)

            if let solution {
                Button {
                    withAnimation(.easeInOut) { showingSolution.toggle() }
                } label: {
                    Label(showingSolution ? "Lösung ausblenden" : "Lösung anzeigen",
                          systemImage: showingSolution ? "eye.slash" : "eye")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .tint(Theme.caseStudy)

                if showingSolution {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Lösung")
                            .font(.subheadline.weight(.semibold))
                        Text(solution)
                            .font(.callout.monospacedDigit())
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(10)
                    .background(Color(.systemBackground).opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
        }
        .padding(14)
        .background(Theme.caseStudy.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2)
                .fill(Theme.caseStudy)
                .frame(width: 4)
                .padding(.vertical, 10)
        }
    }
}
