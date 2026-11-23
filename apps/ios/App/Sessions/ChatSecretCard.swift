import Observation
import RuimtePulsar
import RuimteTransport
import SwiftUI

/// What a secret card asks and sends. A typed value passes through `savePayload` on its way to the machine and is kept
/// nowhere else: not in a store, a log, a report or a notification.
extension SecretRequest {
    /// The name of the one field of a card without `fields`. It never travels: such a card answers with `value`.
    static let singleFieldName = "value"

    /// Several values in one card, or nil for a card that asks for one.
    var severalFields: [SecretField]? {
        guard let fields, !fields.isEmpty else { return nil }
        return fields
    }

    /// The fields the card draws: its own, or one secret field under the card's label.
    var entries: [SecretField] {
        severalFields
            ?? [
                SecretField(
                    name: Self.singleFieldName, label: label,
                    placeholder: placeholder ?? String(localized: "Paste the secret"), masked: true)
            ]
    }

    /// The page where the person finds or makes the value, only an http(s) address with a host.
    var page: URL? {
        guard let url, let page = URL(string: url), ["http", "https"].contains(page.scheme?.lowercased()),
            let host = page.host(), !host.isEmpty
        else {
            return nil
        }
        return page
    }

    /// The `secret.save` payload, or nil while a field is still empty, which the machine would refuse.
    func savePayload(_ values: [String: String]) -> JSONValue? {
        guard entries.allSatisfy({ values[$0.name]?.isEmpty == false }) else { return nil }
        guard let fields = severalFields else {
            return .object(["requestId": .string(requestId), "value": .string(values[Self.singleFieldName] ?? "")])
        }
        let byName = Dictionary(
            fields.map { ($0.name, JSONValue.string(values[$0.name] ?? "")) }, uniquingKeysWith: { first, _ in first })
        return .object(["requestId": .string(requestId), "values": .object(byName)])
    }

    var privacyLine: String {
        if delivery == .file {
            return severalFields == nil
                ? String(localized: "Kept out of chat, in a private file this agent's commands can read for 24 hours")
                : String(localized: "Kept out of chat, in private files this agent's commands can read for 24 hours")
        }
        guard let variable, let launchName, !launchName.isEmpty else {
            return String(localized: "Saved on this machine. Only its launch gets it, never the agent.")
        }
        return String(localized: "Saved on this machine as \(variable). Only \(launchName) gets it, never the agent.")
    }

    var replacesLine: String? {
        guard replaces, delivery != .file, let variable else { return nil }
        return String(localized: "Replaces the current value of \(variable).")
    }
}

enum SecretAnswer {
    case save, decline
}

/// The secret cards of one chat and the person's answers to them. It holds no value: `save` takes the values for the
/// one request that carries them.
@MainActor @Observable
final class ChatSecretAnswers {
    private var live: [SecretRequest] = []
    private var answered: Set<String> = []
    private(set) var sending: (id: String, answer: SecretAnswer)?
    private(set) var errors: [String: String] = [:]

    var cards: [SecretRequest] { live.filter { !answered.contains($0.requestId) } }

    func update(_ cards: [SecretRequest]) {
        live = cards
        let ids = Set(cards.map(\.requestId))
        answered.formIntersection(ids)
        errors = errors.filter { ids.contains($0.key) }
    }

    /// True once the machine took the values.
    func save(_ request: SecretRequest, values: [String: String], client: any MachineRequesting) async -> Bool {
        guard let payload = request.savePayload(values) else { return false }
        return await send(request, .save, .secretSave, payload, client: client)
    }

    func decline(_ request: SecretRequest, client: any MachineRequesting) async {
        _ = await send(
            request, .decline, .secretDecline, .object(["requestId": .string(request.requestId)]), client: client)
    }

    private func send(
        _ request: SecretRequest, _ answer: SecretAnswer, _ type: WireRequest, _ payload: JSONValue,
        client: any MachineRequesting
    ) async -> Bool {
        guard sending == nil else { return false }
        let id = request.requestId
        sending = (id, answer)
        errors[id] = nil
        defer { sending = nil }
        let failure: String
        do {
            let result = try await client.request(type, payload: payload)
            if result["accepted"]?.boolValue == true {
                // Hidden only while the machine still lists it, so a card that comes back shows again.
                if isLive(id) { answered.insert(id) }
                return true
            }
            failure = String(localized: "Already answered or expired")
        } catch {
            failure = error.localizedDescription
        }
        if isLive(id) { errors[id] = failure }
        return false
    }

    private func isLive(_ id: String) -> Bool { live.contains { $0.requestId == id } }
}

/// The cards in which an agent of this chat asks for a secret, above its composer.
struct ChatSecretDock: View {
    let store: ProposalStore
    let chatID: String
    let client: any MachineRequesting
    let connected: Bool
    @State private var answers = ChatSecretAnswers()

    var body: some View {
        let features = client as? MachineFeatures
        let canAnswer = features?.answers(.secretSave) == true && features?.answers(.secretDecline) == true
        VStack(spacing: 0) {
            ForEach(answers.cards, id: \.requestId) { request in
                ChatSecretCard(
                    request: request, canAnswer: canAnswer,
                    sending: answers.sending?.id == request.requestId ? answers.sending?.answer : nil,
                    locked: answers.sending != nil, error: answers.errors[request.requestId], connected: connected,
                    save: { values in await answers.save(request, values: values, client: client) },
                    decline: { Task { await answers.decline(request, client: client) } })
            }
        }
        .onChange(of: store.secretCards(for: chatID), initial: true) { _, cards in answers.update(cards) }
    }
}

private struct ChatSecretCard: View {
    let request: SecretRequest
    let canAnswer: Bool
    let sending: SecretAnswer?
    let locked: Bool
    let error: String?
    let connected: Bool
    let save: ([String: String]) async -> Bool
    let decline: () -> Void
    // The typed values live here alone, and only until they are sent.
    @State private var values: [String: String] = [:]
    @State private var revealed: Set<String> = []
    @Environment(\.openURL) private var openURL

    private var disabled: Bool { locked || !connected || !canAnswer }
    private var ready: Bool { request.savePayload(values) != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Image(lucide: "key-round", size: 15).foregroundStyle(MobileStyle.statusNeedsYou)
                        .accessibilityHidden(true)
                    Text(request.label).font(.subheadline.weight(.semibold)).foregroundStyle(MobileStyle.text)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                }
                if !request.reason.isEmpty {
                    Text(request.reason).font(.footnote).foregroundStyle(MobileStyle.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if let page = request.page {
                VStack(alignment: .leading, spacing: 4) {
                    Button(String(localized: "Open \(page.host() ?? "")"), lucideIcon: "external-link") {
                        openURL(page)
                    }
                    .buttonStyle(.mobileCapsuleSmall)
                    Text(page.absoluteString).font(.system(.caption, design: .monospaced))
                        .foregroundStyle(MobileStyle.muted).lineLimit(2).textSelection(.enabled)
                }
            }
            if canAnswer {
                inputs
            } else {
                Text("Answer this in Ruimte on the machine, or update Ruimte to answer here.")
                    .font(.caption).foregroundStyle(MobileStyle.muted)
            }
            if let error {
                Text(error).font(.footnote).foregroundStyle(MobileStyle.statusError)
                    .accessibilityLabel("Could not send. \(error)")
            }
            if !connected {
                Label(String(localized: "Not connected"), lucideIcon: "wifi-off").font(.caption)
                    .foregroundStyle(MobileStyle.muted)
            }
            footer
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .chatDockCard(vertical: 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat.secret")
    }

    @ViewBuilder private var inputs: some View {
        if let fields = request.severalFields {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(fields, id: \.name) { field in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(field.label).font(.caption.weight(.medium)).foregroundStyle(MobileStyle.muted)
                        input(field)
                    }
                }
            }
        } else if let field = request.entries.first {
            HStack(spacing: 8) {
                input(field)
                saveButton
            }
        }
    }

    private var footer: some View {
        HStack(alignment: .center, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Label {
                    Text(request.privacyLine)
                } icon: {
                    Image(lucide: "shield-check", size: 12)
                }
                .font(.caption).foregroundStyle(MobileStyle.muted)
                .fixedSize(horizontal: false, vertical: true)
                if let replaces = request.replacesLine {
                    Text(replaces).font(.caption).foregroundStyle(MobileStyle.muted)
                }
            }
            Spacer(minLength: 0)
            if canAnswer {
                Button(
                    sending == .decline ? String(localized: "Declining…") : String(localized: "Decline"),
                    action: decline
                )
                .buttonStyle(.plain).font(.footnote.weight(.medium)).foregroundStyle(MobileStyle.muted)
                .frame(minHeight: 30).contentShape(.rect)
                .disabled(disabled)
                if request.severalFields != nil {
                    saveButton
                }
            }
        }
    }

    private var saveButton: some View {
        Button(sending == .save ? String(localized: "Saving…") : String(localized: "Save securely"), action: send)
            .buttonStyle(.mobileCapsuleSmallProminent)
            .disabled(disabled || !ready)
    }

    private func input(_ field: SecretField) -> some View {
        SecretInput(
            title: field.label, prompt: field.placeholder ?? "", masked: field.masked != false,
            text: Binding(get: { values[field.name] ?? "" }, set: { values[field.name] = $0 }),
            revealed: Binding(
                get: { revealed.contains(field.name) },
                set: { show in
                    if show { revealed.insert(field.name) } else { revealed.remove(field.name) }
                })
        )
        .disabled(locked || !connected)
    }

    /// Clears the fields the moment the values leave, and puts them back only when the machine did not take them.
    private func send() {
        let sent = values
        values = [:]
        revealed = []
        Task {
            if await !save(sent) { values = sent }
        }
    }
}

/// One field of a secret card: hidden unless the field is no secret or the person shows it.
private struct SecretInput: View {
    let title: String
    let prompt: String
    let masked: Bool
    @Binding var text: String
    @Binding var revealed: Bool

    var body: some View {
        HStack(spacing: 4) {
            Group {
                if masked && !revealed {
                    SecureField(title, text: $text, prompt: Text(prompt))
                } else {
                    TextField(title, text: $text, prompt: Text(prompt))
                }
            }
            .font(.subheadline)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            // A one-time code is a type the Passwords app neither fills nor offers to save, unlike a password field.
            .textContentType(.oneTimeCode)
            .privacySensitive()
            .frame(maxWidth: .infinity)
            if masked {
                Button {
                    revealed.toggle()
                } label: {
                    Image(lucide: revealed ? "eye-off" : "eye", size: 15).foregroundStyle(MobileStyle.muted)
                        .frame(width: 30, height: 30).contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(revealed ? String(localized: "Hide \(title)") : String(localized: "Show \(title)"))
            }
        }
        .padding(.leading, 12).padding(.trailing, masked ? 4 : 12)
        .frame(minHeight: 36)
        .background(MobileStyle.fill, in: .rect(cornerRadius: 12))
    }
}
