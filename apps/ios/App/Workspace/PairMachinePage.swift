import Foundation
import RuimtePulsar
import RuimteTransport
import SwiftUI

struct PairMachinePage: View {
    let runtime: AppRuntime
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var problem: String?
    @State private var pairing = false
    var body: some View {
        NavigationStack {
            MobileForm {
                Section {
                    VStack(alignment: .leading, spacing: 14) {
                        MobileIcon(symbol: "link")
                        Text("Connect your computer").font(.title2.weight(.bold))
                        Text(
                            "In Ruimte on your computer, open Remote settings and create a pairing link. Paste it below to bring your projects here."
                        )
                        .font(.body).foregroundStyle(MobileStyle.muted)
                    }.padding(.vertical, 12)
                }.listRowBackground(Color.clear)
                Section("Pairing link") {
                    TextField("https://…/pair#…", text: $text, axis: .vertical)
                        .lineLimit(2...4).keyboardType(.URL).textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("pairing.link")
                    PasteButton(payloadType: String.self) { values in
                        if let value = values.first {
                            text = value
                            problem = nil
                        }
                    }.disabled(pairing)
                }
                Section {
                    Button {
                        Task { await pair() }
                    } label: {
                        HStack {
                            if pairing { ProgressView().tint(MobileStyle.onAccent) }
                            Text(pairing ? "Connecting…" : "Connect computer")
                        }.font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 32)
                    }
                    .buttonStyle(.borderedProminent)
                    .foregroundStyle(MobileStyle.onAccent)
                    .disabled(pairing || (try? SecurePairingLink(text)) == nil)
                } footer: {
                    Text("No account needed. Your projects stay on your computer.")
                }.listRowBackground(Color.clear)
                if let problem { Text(problem).foregroundStyle(.red) }
            }
            .navigationTitle("Pair a computer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(pairing) }
            }
            .interactiveDismissDisabled(pairing)
        }
    }
    private func pair() async {
        pairing = true
        defer { pairing = false }
        do {
            let link = try SecurePairingLink(text)
            guard let key = runtime.key else {
                throw PairingFailure(code: "no-key", message: "The device key is not ready. Try again.")
            }
            let result = try await PairingClient().pair(link, publicKey: key.publicKey, label: "Ruimte on iOS")
            guard let machine = result.endpoint.pairedMachine() else {
                throw PairingFailure(
                    code: "unreachable",
                    message:
                        "Pairing succeeded, but this machine needs a public key and secure broker before iOS can connect."
                )
            }
            UserDefaultsPairingStore().insert(
                PairingIdentity(machineID: machine.id, machineKey: machine.publicKey, clientKey: key.publicKey))
            runtime.addPairedMachine(machine)
            dismiss()
        } catch is CancellationError {
        } catch {
            problem = error.localizedDescription
        }
    }
}
