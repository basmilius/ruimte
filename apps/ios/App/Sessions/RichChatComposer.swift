import SwiftUI
import UIKit

struct RichChatComposer: UIViewRepresentable {
    @Binding var text: String
    @Binding var selection: NSRange
    let mentions: [String]
    let skills: [String]
    let focused: FocusState<Bool>.Binding
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme

    func makeUIView(context: Context) -> ComposerTextView {
        let storage = NSTextStorage()
        let layout = ComposerLayoutManager()
        let container = NSTextContainer(size: .zero)
        container.widthTracksTextView = true
        storage.addLayoutManager(layout)
        layout.addTextContainer(container)
        let view = ComposerTextView(frame: .zero, textContainer: container)
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.adjustsFontForContentSizeCategory = true
        view.keyboardDismissMode = .interactive
        view.alwaysBounceVertical = false
        view.contentInsetAdjustmentBehavior = .never
        view.delegate = context.coordinator
        view.accessibilityLabel = "Message the agent"
        view.accessibilityIdentifier = "chat.composer"
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: ComposerTextView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.updating = true
        defer { context.coordinator.updating = false }
        view.isEditable = isEnabled
        view.tintColor = .label
        // Replacing marked text interrupts composition for Chinese, Japanese and dictation.
        if view.markedTextRange == nil {
            if view.text != text { view.text = text }
            context.coordinator.decorate(view)
            let length = (view.text as NSString).length
            let location = min(selection.location, length)
            let desired = NSRange(location: location, length: min(selection.length, length - location))
            if view.selectedRange != desired { view.selectedRange = desired }
        }
        if focused.wrappedValue && isEnabled && !view.isFirstResponder {
            view.becomeFirstResponder()
        } else if !focused.wrappedValue && view.isFirstResponder {
            view.resignFirstResponder()
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ComposerTextView, context: Context) -> CGSize? {
        guard let width = proposal.width else { return nil }
        let font = UIFont.preferredFont(forTextStyle: .body, compatibleWith: uiView.traitCollection)
        let measured = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        let height = ceil(min(max(measured, font.lineHeight), font.lineHeight * 6))
        uiView.isScrollEnabled = measured > height + 1
        return CGSize(width: width, height: height)
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: RichChatComposer
        var updating = false
        private var lastStyle: String?

        init(_ parent: RichChatComposer) { self.parent = parent }

        func textViewDidChange(_ textView: UITextView) {
            guard !updating, let view = textView as? ComposerTextView else { return }
            parent.text = view.text
            parent.selection = view.selectedRange
            if view.markedTextRange == nil { decorate(view) }
            view.invalidateIntrinsicContentSize()
        }

        func textViewDidChangeSelection(_ textView: UITextView) {
            guard !updating else { return }
            parent.selection = textView.selectedRange
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            if !updating { parent.focused.wrappedValue = true }
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            if !updating { parent.focused.wrappedValue = false }
        }

        func decorate(_ view: ComposerTextView) {
            let font = UIFont.preferredFont(forTextStyle: .body, compatibleWith: view.traitCollection)
            view.placeholder.font = font
            view.placeholder.isHidden = !view.text.isEmpty
            let signature =
                "\(view.text ?? "")\u{0}\(parent.mentions)\(parent.skills)\(font.pointSize)\(parent.colorScheme)"
            guard signature != lastStyle else { return }
            lastStyle = signature
            let selected = view.selectedRange
            let offset = view.contentOffset
            let attributes = ChatDraftStyle.attributed(
                view.text, font: font, mentions: parent.mentions, skills: parent.skills)
            let wasUpdating = updating
            updating = true
            defer { updating = wasUpdating }
            // Attribute-only edits retain UIKit's text undo, selection and raw wire representation.
            view.textStorage.beginEditing()
            view.textStorage.setAttributes(
                [.font: font, .foregroundColor: UIColor.label],
                range: NSRange(location: 0, length: view.textStorage.length))
            attributes.enumerateAttributes(in: NSRange(location: 0, length: attributes.length)) { values, range, _ in
                view.textStorage.addAttributes(values, range: range)
            }
            view.textStorage.endEditing()
            view.typingAttributes = [.font: font, .foregroundColor: UIColor.label]
            view.selectedRange = selected
            view.setContentOffset(offset, animated: false)
        }
    }
}

final class ComposerTextView: UITextView {
    let placeholder = UILabel()

    override init(frame: CGRect, textContainer: NSTextContainer?) {
        super.init(frame: frame, textContainer: textContainer)
        placeholder.text = "Message the agent…"
        placeholder.textColor = .placeholderText
        placeholder.isUserInteractionEnabled = false
        placeholder.isAccessibilityElement = false
        addSubview(placeholder)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        placeholder.frame = CGRect(x: 0, y: 0, width: bounds.width, height: placeholder.font.lineHeight)
    }
}

private final class ComposerLayoutManager: NSLayoutManager {
    override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: CGPoint) {
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
        guard let storage = textStorage else { return }
        let characters = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
        storage.enumerateAttribute(ChatDraftStyle.badge, in: characters) { value, range, _ in
            guard let color = value as? UIColor else { return }
            let glyphs = self.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            self.enumerateLineFragments(forGlyphRange: glyphs) { _, _, container, line, _ in
                let intersection = NSIntersectionRange(glyphs, line)
                var bounds = self.boundingRect(forGlyphRange: intersection, in: container)
                bounds = bounds.offsetBy(dx: origin.x, dy: origin.y).insetBy(dx: 0, dy: -1)
                color.setFill()
                UIBezierPath(roundedRect: bounds, cornerRadius: 5).fill()
            }
        }
    }
}

private enum ChatDraftStyle {
    static let badge = NSAttributedString.Key("RuimteComposerBadge")

    static func attributed(_ text: String, font: UIFont, mentions: [String], skills: [String]) -> NSAttributedString {
        let result = NSMutableAttributedString(
            string: text, attributes: [.font: font, .foregroundColor: UIColor.label])
        let code = ChatDraftSyntax.codeRanges(in: text)
        func apply(_ pattern: String, _ values: [NSAttributedString.Key: Any]) {
            for match in ChatDraftSyntax.matches(pattern, in: text)
            where !code.contains(where: { NSIntersectionRange($0, match.range).length > 0 }) {
                result.addAttributes(values, range: match.range)
            }
        }
        func weight(_ traits: UIFontDescriptor.SymbolicTraits) -> UIFont {
            UIFont(
                descriptor: font.fontDescriptor.withSymbolicTraits(traits) ?? font.fontDescriptor, size: font.pointSize)
        }
        apply(#"(?m)^#{1,6} .+$"#, [.font: weight(.traitBold)])
        apply(#"\*\*[^*\n]+\*\*|__[^_\n]+__"#, [.font: weight(.traitBold)])
        apply(#"(?<!\*)\*[^*\n]+\*(?!\*)|(?<![\w_])_[^_\n]+_(?![\w_])"#, [.font: weight(.traitItalic)])
        apply(#"~~[^~\n]+~~"#, [.strikethroughStyle: NSUnderlineStyle.single.rawValue])
        apply(#"\[[^\]\n]+\]\([^\s)]+\)"#, [.underlineStyle: NSUnderlineStyle.single.rawValue])
        apply(#"(?m)^\s*(?:>\s|[-+*]\s|\d+\.\s)"#, [.foregroundColor: UIColor.secondaryLabel])
        apply(#"(?m)^#{1,6}(?= )|\*\*|__|~~|(?<!\*)\*(?!\*)"#, [.foregroundColor: UIColor.secondaryLabel])
        for range in code {
            result.addAttributes(
                [
                    .font: UIFont.monospacedSystemFont(ofSize: font.pointSize, weight: .regular),
                    .backgroundColor: UIColor.secondarySystemFill,
                ], range: range)
        }
        for token in ChatDraftSyntax.tokens(in: text, mentions: mentions, skills: skills) {
            result.addAttributes([.font: weight(.traitBold), badge: UIColor.tertiarySystemFill], range: token.range)
        }
        return result
    }
}
