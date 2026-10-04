import RuimtePulsar
import SwiftUI

/// The name and icon of a machine, which every client that reaches it sees. Both go out together, since an empty
/// name hands the machine back to the one it starts with and no icon is a choice of its own. On an iPad the apps with
/// access stand in the same sheet.
struct MachineIdentitySheet: View {
    let endpoint: MachineEndpoint
    let fallbackName: String
    /// The machine whose clients the sheet lists as well; nil leaves them to a sheet of their own.
    var access: (session: SharedMachineSession, runtime: AppRuntime)?
    @State private var name = ""
    @State private var icon: String?
    @State private var saving = false
    @State private var problem: String?
    @Environment(\.dismiss) private var dismiss

    /// From the closed set a project and a view pick from (`contracts/src/project.ts`), the ones a computer wears.
    static let icons = [
        "laptop", "server", "monitor", "pc-case", "cpu", "hard-drive", "cloud", "container", "rocket", "smartphone",
        "tablet", "folder", "terminal", "globe", "sparkles", "house", "briefcase", "flask-conical", "gamepad-2", "bot",
    ]

    var body: some View {
        NavigationStack {
            MobileForm {
                Section {
                    LucideIcon(name: icon ?? "server", size: 30)
                        .frame(width: 64, height: 64)
                        .background(MobileStyle.panel, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
                        .frame(maxWidth: .infinity)
                        .accessibilityHidden(true)
                }
                .listRowBackground(Color.clear)
                Section {
                    TextField(fallbackName, text: $name)
                        .textInputAutocapitalization(.words)
                        .submitLabel(.done)
                } header: {
                    Text("Name")
                } footer: {
                    Text("Every client that reaches this machine sees these. Leave it empty for the machine's own name.")
                }
                Section("Icon") {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 5), spacing: 8) {
                        ForEach(Self.icons, id: \.self) { name in
                            Button {
                                icon = icon == name ? nil : name
                            } label: {
                                LucideIcon(name: name, size: 19)
                                    .frame(maxWidth: .infinity, minHeight: 44)
                                    .background(
                                        icon == name ? MobileStyle.active : MobileStyle.inset,
                                        in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(name.replacingOccurrences(of: "-", with: " "))
                            .accessibilityAddTraits(icon == name ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 6)
                }
                if let problem {
                    Section { Text(problem).foregroundStyle(.red) }
                }
                if let access {
                    MachineAccessSection(session: access.session, runtime: access.runtime, name: fallbackName)
                }
            }
            .disabled(saving)
            .navigationTitle(access == nil ? "Name and icon" : "Machine settings")
            .navigationSubtitle(fallbackName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.disabled(saving)
                }
            }
            .task {
                name = endpoint.info?["nameSource"]?.stringValue == "chosen" ? endpoint.label ?? "" : ""
                icon = endpoint.icon?.value
            }
        }
        .presentationDetents([.large])
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            try await endpoint.setIdentity(name: name, icon: icon.map { MachineIcon(value: $0) })
            dismiss()
        } catch {
            problem = error.localizedDescription
        }
    }
}
