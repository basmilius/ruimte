import SwiftUI

/// A request an agent waits on, as Now, Scheduled and the chat draw it: who asks (the waiting glyph, the title and
/// where it stands, with how long it waits), what it asks, and the content to answer it with. The header opens the
/// asker when `open` is set. The accessory follows the title, for a mark such as a task's.
struct MobileRequestCard<Accessory: View, Content: View>: View {
    var symbol: String?
    let title: String
    var subtitle: String?
    var openHint: String?
    var open: (() -> Void)?
    @ViewBuilder var accessory: Accessory
    @ViewBuilder var content: Content

    var body: some View {
        MobileCard(filled: true) {
            if let open {
                Button(action: open) { header(disclosure: true) }
                    .buttonStyle(.plain)
                    .accessibilityHint(openHint ?? "")
            } else {
                header(disclosure: false)
            }
            content
        }
        .accessibilityElement(children: .contain)
    }

    private func header(disclosure: Bool) -> some View {
        HStack(spacing: MobileSpacing.medium) {
            HStack(alignment: .firstTextBaseline, spacing: MobileSpacing.medium) {
                MobileStatusGlyph(tone: .waiting, symbol: symbol).centeredOnFirstLine(of: .subheadline)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        Text(verbatim: title).font(.subheadline.weight(.semibold)).foregroundStyle(MobileStyle.text)
                            .lineLimit(1).truncationMode(.tail)
                        accessory
                    }
                    if let subtitle, !subtitle.isEmpty {
                        Text(verbatim: subtitle).font(.caption).foregroundStyle(MobileStyle.muted).lineLimit(1)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if disclosure {
                Image(lucide: "chevron-right", size: 14).foregroundStyle(MobileStyle.muted).accessibilityHidden(true)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

extension MobileRequestCard where Accessory == EmptyView {
    init(
        symbol: String? = nil, title: String, subtitle: String? = nil, openHint: String? = nil,
        open: (() -> Void)? = nil, @ViewBuilder content: () -> Content
    ) {
        self.init(
            symbol: symbol, title: title, subtitle: subtitle, openHint: openHint, open: open,
            accessory: { EmptyView() },
            content: content)
    }
}

/// What the agent wants, in its own words: the first line under a request's header.
struct MobileRequestHeadline: View {
    let text: String

    var body: some View {
        Text(verbatim: text).font(.subheadline).foregroundStyle(MobileStyle.text).lineLimit(4)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// The command or change a request names. A diff colors its added and removed lines.
struct MobileRequestCode: View {
    let text: String
    var diff = false
    var truncated = false
    var maxLines: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(verbatim: line.isEmpty ? " " : line).foregroundStyle(color(line)).lineLimit(1)
                    .truncationMode(.tail)
            }
            if truncated {
                Text(verbatim: "…").foregroundStyle(MobileStyle.muted).accessibilityLabel("The rest is in the chat")
            }
        }
        .font(.system(.caption, design: .monospaced))
        .padding(.horizontal, MobileSpacing.medium)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(MobileStyle.subtleFill, in: RoundedRectangle(cornerRadius: MobileMetrics.tileRadius))
    }

    private var lines: [String] {
        let all = text.components(separatedBy: "\n")
        return maxLines.map { Array(all.prefix($0)) } ?? all
    }

    private func color(_ line: String) -> Color {
        if !diff {
            return MobileStyle.text
        }
        if line.hasPrefix("+") {
            return MobileStyle.positive
        }
        if line.hasPrefix("-") {
            return MobileStyle.statusError
        }
        return MobileStyle.muted
    }
}

/// Deny, Reply where the agent takes a reason, and Allow, which leads and shows the send while it runs.
struct MobilePermissionActions: View {
    var sending = false
    let deny: () -> Void
    var reply: (() -> Void)?
    let allow: () -> Void

    var body: some View {
        HStack(spacing: MobileSpacing.small) {
            Button("Deny", action: deny).buttonStyle(.mobileCapsule)
            if let reply {
                Button("Reply…", action: reply).buttonStyle(.mobileCapsule)
            }
            Spacer(minLength: 0)
            MobileSendButton(title: String(localized: "Allow"), sending: sending, action: allow)
        }
    }
}

struct MobileSendButton: View {
    let title: String
    var sending = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            if sending {
                ProgressView().controlSize(.small).accessibilityLabel("Sending…")
            } else {
                Text(title)
            }
        }
        .buttonStyle(.mobileCapsuleProminent)
    }
}

/// One choice of a question as a capsule. A chosen one turns prominent and gets a check, so it reads as picked
/// without its color.
struct MobileChoiceButton: View {
    let label: String
    var picked = false
    var hint: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if picked {
                    Image(lucide: "check", size: 14).accessibilityHidden(true)
                }
                Text(verbatim: label).lineLimit(2)
            }
        }
        .buttonStyle(MobileCapsuleButtonStyle(prominent: picked))
        .accessibilityHint(hint ?? "")
        .accessibilityAddTraits(picked ? .isSelected : [])
    }
}
