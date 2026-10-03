import SwiftUI

/// A flyout of the composer: a popover that grows from the control it belongs to, also on an iPhone, with a small
/// heading and rows of the composer handoff's sizes.
struct ChatFlyout<Content: View>: View {
    var heading: String?
    var width: CGFloat = 260
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let heading {
                Text(heading)
                    .font(.caption.weight(.semibold)).foregroundStyle(MobileStyle.faint)
                    .padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 4)
                    .accessibilityAddTraits(.isHeader)
            }
            content()
        }
        .padding(6)
        .frame(width: width)
        .presentationCompactAdaptation(.popover)
    }
}

/// A choice in a flyout: the picked one highlighted with a check.
struct ChatFlyoutRow: View {
    let title: String
    var detail: String?
    var detailColor = MobileStyle.muted
    var icon: String?
    var checked = false
    var trailing: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if let icon {
                    Image(lucide: icon, size: 15).foregroundStyle(MobileStyle.muted).accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.subheadline).foregroundStyle(MobileStyle.text).lineLimit(1)
                    if let detail, !detail.isEmpty {
                        Text(detail).font(.caption).foregroundStyle(detailColor).lineLimit(2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let trailing {
                    Image(lucide: trailing, size: 13).foregroundStyle(MobileStyle.muted).accessibilityHidden(true)
                }
                if checked {
                    Image(lucide: "check", size: 15).foregroundStyle(MobileStyle.accent).accessibilityHidden(true)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
            .frame(minHeight: 44)
            .background(checked ? MobileStyle.text.opacity(0.08) : .clear, in: Self.shape)
            .contentShape(Self.shape)
        }
        .buttonStyle(ChatComposerButtonStyle())
        .accessibilityAddTraits(checked ? .isSelected : [])
    }

    private static let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
}

struct ChatFlyoutDivider: View {
    var body: some View {
        Rectangle().fill(MobileStyle.text.opacity(0.08)).frame(height: 1)
            .padding(.horizontal, 10).padding(.vertical, 4)
    }
}
