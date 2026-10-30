import RuimtePulsar
import SwiftUI

struct NewChatAccountPicker: View {
    @Bindable var model: NewChatModel
    let provider: String
    var project: JSONValue?

    private var entries: [ProviderAccountEntry] { model.accounts?.accounts(of: provider) ?? [] }

    var body: some View {
        let names = Dictionary(grouping: entries, by: { $0.name(provider: ProcessesText.agentName(provider)) })
        Section {
            Picker(
                "Account",
                selection: Binding(
                    get: { model.choices[provider] ?? "" },
                    set: { model.choose($0.isEmpty ? nil : $0, provider: provider) }
                )
            ) {
                Text("Automatic").tag("")
                ForEach(entries) { entry in
                    let name = entry.name(provider: ProcessesText.agentName(provider))
                    let reason = model.unavailable(entry, project: project)
                    let label = (names[name]?.count ?? 0) > 1 ? "\(name) (\(entry.id))" : name
                    HStack {
                        AccountDot(color: entry.color)
                        Text(reason.map { "\(label) · \($0)" } ?? label)
                    }
                    .tag(entry.id).disabled(reason != nil)
                }
                if let chosen = model.choices[provider], !entries.contains(where: { $0.id == chosen }) {
                    Text("\(chosen) · Unavailable").tag(chosen).disabled(true)
                }
            }
            .accessibilityIdentifier("newChat.account.\(provider)")
            if let picked = model.choices[provider], let entry = entries.first(where: { $0.id == picked }) {
                if let reason = model.unavailable(entry, project: project) {
                    Text(reason).font(.caption).foregroundStyle(MobileStyle.statusError)
                } else if let reading = ProviderAccountList.limitsEntry(model.limits, account: picked),
                    let checked = reading["checkedAt"]?.numberValue, checked > 0,
                    reading["unavailable"] == nil || reading["unavailable"] == .null,
                    let window = ProviderAccountList.sessionWindow(model.limits, account: picked)
                {
                    Text(ChatLimits.sessionLine(window)).font(.caption).monospacedDigit()
                    Text("Checked \(Format.dayClockWithYear(Date(timeIntervalSince1970: checked / 1000)))")
                        .font(.caption).foregroundStyle(MobileStyle.muted)
                }
            }
            if let problem = model.accountsProblem {
                Text(problem).font(.caption).foregroundStyle(MobileStyle.statusError)
                Button("Try again") { Task { await model.load() } }
            }
        } footer: {
            if let preferred = project?["accounts"]?[provider]?["default"]?.stringValue {
                let name =
                    entries.first { $0.id == preferred }?.name(provider: ProcessesText.agentName(provider)) ?? preferred
                Text("Automatic prefers \(name) for this project.")
            } else {
                Text("Automatic uses this machine's account defaults.")
            }
        }
    }
}

struct NewChatAccountSheet: View {
    @Bindable var model: NewChatModel
    let provider: String
    var project: JSONValue?
    let connected: Bool
    var starting = false
    let start: () -> Void
    let close: () -> Void

    var body: some View {
        NavigationStack {
            MobileForm {
                NewChatAccountPicker(model: model, provider: provider, project: project)
                if let problem = model.problem { Text(problem).foregroundStyle(MobileStyle.statusError) }
            }
            .disabled(starting)
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: close).disabled(starting) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start chat", action: start)
                        .disabled(!connected || starting || model.refusal(provider: provider, project: project) != nil)
                }
            }
        }
    }
}
