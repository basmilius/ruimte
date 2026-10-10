import RuimtePulsar
import SwiftUI

/// The line under a block, only when it has something to say: live, answered, repaired or shown as text, in that
/// order. A hairline runs the full width of the card over it.
struct UiBlockFooter: View {
    let context: UiRenderContext
    let nodes: [UiNode]
    let shownAsText: UiBlockText?
    @State private var fixesOpen = false
    @State private var hint: String?

    var body: some View {
        let model = context.model
        let live = UiLiveStatus.of(
            block: model.block, order: model.queryNames, readings: model.readings, reading: model.reading)
        let fixes = UiBlockFix.list((model.block["diagnostics"]?.arrayValue ?? []) + model.diagnostics)
        let answered = answeredLabel
        if live != nil || answered != nil || !fixes.isEmpty || shownAsText != nil {
            VStack(alignment: .leading, spacing: 6) {
                UiFlowLayout(spacing: 12) {
                    if let live { UiLivePart(live: live, hint: $hint) }
                    if let answered {
                        HStack(spacing: 4) {
                            Text("Answered with “\(answered)”")
                            if let at = model.answer?["at"]?.numberValue {
                                Text(verbatim: "·").accessibilityHidden(true)
                                Text(UiFormat.moment(milliseconds: at), format: .dateTime.hour().minute())
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                    if !fixes.isEmpty {
                        Button {
                            fixesOpen.toggle()
                        } label: {
                            Label(String(localized: "\(fixes.count) fixes"), lucideIcon: "wrench", iconSize: 12)
                                .frame(minHeight: 44).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityValue(fixesOpen ? String(localized: "Expanded") : String(localized: "Collapsed"))
                    }
                    if let shownAsText {
                        HStack(spacing: 4) {
                            Text("Shown as text")
                            Text(verbatim: "·").accessibilityHidden(true)
                            Text(Self.reason(shownAsText))
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                if let hint {
                    Text(hint).foregroundStyle(MobileStyle.muted)
                }
                if fixesOpen {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(fixes.enumerated()), id: \.offset) { _, fix in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text(fix.code).font(.system(.caption, design: .monospaced))
                                Text(fix.message)
                            }
                        }
                    }
                    .foregroundStyle(MobileStyle.muted)
                }
            }
            .font(.caption).foregroundStyle(MobileStyle.faint)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16).padding(.vertical, 6)
            .overlay(alignment: .top) { Rectangle().fill(MobileStyle.border).frame(height: 1) }
        }
    }

    /// The label of the choice that answered the block: the daemon's when it has one, else the row that was tapped.
    private var answeredLabel: String? {
        guard let answer = context.model.answer, answer["state"] != .string("sending") else { return nil }
        if let label = answer["label"]?.stringValue, !label.isEmpty { return label }
        guard let id = answer["choiceId"]?.stringValue else { return nil }
        func find(_ nodes: [UiNode]) -> UiNode? {
            for node in nodes {
                if node.id == id { return node }
                if let found = find(node.children) { return found }
            }
            return nil
        }
        return find(nodes)?.label
    }

    private static func reason(_ text: UiBlockText) -> String {
        switch text {
        case .unreadable: String(localized: "The block could not be read")
        case .tooLarge: String(localized: "The block is too large to draw")
        case .diagnostic(let message): message
        }
    }
}

/// The one sign of a live block: what it reads and when it last read it. A reading spins only after a second, and
/// the time follows the clock without being read out at every tick.
private struct UiLivePart: View {
    let live: UiLiveStatus
    @Binding var hint: String?
    @State private var slow = false

    var body: some View {
        let detail: String? =
            live.state == .failed && live.reason != nil
            ? live.reason
            : live.sources.isEmpty ? nil : String(localized: "Reads \(live.sources.joined(separator: ", "))")
        Button {
            hint = hint == nil ? detail : nil
        } label: {
            HStack(spacing: 6) {
                icon
                Text(words)
                if let readAt = live.readAt, live.state != .refused {
                    Text(verbatim: "·").accessibilityHidden(true)
                    TimelineView(.periodic(from: .now, by: 1)) { _ in
                        let ago = readAt.formatted(
                            .relative(presentation: .numeric, unitsStyle: .abbreviated).locale(.current))
                        Text(live.state == .fresh || live.state == .reading ? String(localized: "read \(ago)") : ago)
                            .monospacedDigit()
                    }
                } else if live.readAt == nil && (live.state == .fresh || live.state == .reading) {
                    Text(verbatim: "·").accessibilityHidden(true)
                    Text("Not read")
                }
            }
            .frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(detail == nil)
        .accessibilityElement(children: .combine)
        .accessibilityHint(detail ?? "")
        .task(id: live.state == .reading) {
            slow = false
            guard live.state == .reading else { return }
            do { try await Task.sleep(for: .seconds(1)) } catch { return }
            slow = true
        }
    }

    @ViewBuilder private var icon: some View {
        if slow && live.state == .reading {
            Spinner(size: 12)
        } else {
            switch live.state {
            case .failed: Image(lucide: "triangle-alert", size: 12).foregroundStyle(MobileStyle.statusNeedsYou)
            case .refused: Image(lucide: "lock", size: 12)
            default: Image(lucide: "radio", size: 12).foregroundStyle(MobileStyle.statusIdle)
            }
        }
    }

    private var words: String {
        let source = live.source ?? live.sources.first ?? ""
        switch live.state {
        case .failed: return String(localized: "Could not read \(source)")
        case .refused: return String(localized: "Not allowed to read \(source)")
        default: return String(localized: "Live")
        }
    }
}
