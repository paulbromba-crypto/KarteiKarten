import SwiftUI

enum Theme {
    /// Farbe einer Phase – von rot (neu) bis grün (gelernt).
    static func color(forPhase phase: Int) -> Color {
        switch phase {
        case 1: return .red
        case 2: return .orange
        case 3: return .purple
        case 4: return .blue
        case 5: return .teal
        default: return .green
        }
    }

    static let known = Color.green
    static let unknown = Color.red
    static let caseStudy = Color.orange
    static let cornerRadius: CGFloat = 20
}

/// Großer, daumenfreundlicher Button.
struct BigButtonStyle: ButtonStyle {
    var color: Color
    var filled: Bool = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 58)
            .padding(.horizontal, 8)
            .foregroundStyle(filled ? Color.white : color)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(filled ? color : color.opacity(0.15))
            )
            .opacity(configuration.isPressed ? 0.75 : 1)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// Fortschrittsbalken mit Prozentangabe.
struct ProgressBarView: View {
    let percent: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Lernfortschritt")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer()
                Text("\(Int(percent.rounded())) %")
                    .font(.subheadline.monospacedDigit().weight(.semibold))
            }
            ProgressView(value: min(max(percent, 0), 100), total: 100)
                .tint(Theme.color(forPhase: 6))
                .scaleEffect(x: 1, y: 1.8, anchor: .center)
                .padding(.vertical, 4)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Übersicht: Karten pro Phase 1–6 und Warteschlange.
struct PhaseOverviewView: View {
    let statistics: DeckStatistics
    /// Wird aufgerufen, wenn eine Phase (1–5) angetippt wird.
    var onSelectPhase: ((Int) -> Void)?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(1...6, id: \.self) { phase in
                    tile(phase: phase)
                }
            }
            HStack {
                Label("Warteschlange", systemImage: "tray.full")
                Spacer()
                Text("\(statistics.queueCount)")
                    .monospacedDigit()
                    .fontWeight(.semibold)
            }
            .font(.subheadline)
            .padding(12)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
            HStack {
                Label("Aktive Lerngruppe", systemImage: "rectangle.stack")
                Spacer()
                Text("\(statistics.activeCount) / \(LearningEngine.groupSize)")
                    .monospacedDigit()
                    .fontWeight(.semibold)
            }
            .font(.subheadline)
            .padding(12)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    @ViewBuilder
    private func tile(phase: Int) -> some View {
        let content = VStack(spacing: 4) {
            Text(phase == 6 ? "Gelernt" : "Phase \(phase)")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
            Text("\(statistics.count(inPhase: phase))")
                .font(.title2.weight(.bold).monospacedDigit())
                .foregroundStyle(Theme.color(forPhase: phase))
        }
        .frame(maxWidth: .infinity, minHeight: 64)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
        .overlay(alignment: .top) {
            Capsule()
                .fill(Theme.color(forPhase: phase))
                .frame(width: 28, height: 4)
                .padding(.top, 6)
        }

        if let onSelectPhase, phase < 6, statistics.count(inPhase: phase) > 0 {
            Button { onSelectPhase(phase) } label: { content }
                .buttonStyle(.plain)
                .accessibilityHint("Nur Karten dieser Phase lernen")
        } else {
            content
        }
    }
}
