import Foundation
import RuimtePulsar
import RuimteTransport
import SwiftUI

struct SecurePairingLink: Equatable {
    let endpoint: URL
    let token: String
    init(_ text: String) throws {
        guard var url = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
            url.scheme == "https", url.host?.isEmpty == false, url.user == nil, url.password == nil,
            url.path == "/pair", url.query == nil, let token = url.fragment, !token.isEmpty
        else {
            throw TransportFailure.invalid("Paste an HTTPS pairing link ending in /pair#token.")
        }
        self.token = token
        url.path = "/auth/pair"
        url.fragment = nil
        guard let endpoint = url.url else { throw TransportFailure.invalid("This pairing address is invalid.") }
        self.endpoint = endpoint
    }
}

private final class PairingRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
    ) {
        // A pairing token belongs only to the origin the user pasted.
        completionHandler(nil)
    }
}

struct PairMachinePage: View {
    let runtime: AppRuntime
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var problem: String?
    @State private var pairing = false
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://machine/pair#token", text: $text).keyboardType(.URL).textInputAutocapitalization(
                        .never
                    ).autocorrectionDisabled()
                } header: {
                    Text("Pairing link")
                } footer: {
                    Text(
                        "Create a pairing link on your machine in Remote settings. The machine needs HTTPS and a secure broker for remote access."
                    )
                }
                if pairing { ProgressView("Pairing with your machine") }
                if let problem { Text(problem).foregroundStyle(.red) }
            }.navigationTitle("Add a machine")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(pairing) }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Pair") { Task { await pair() } }.disabled(
                            pairing || (try? SecurePairingLink(text)) == nil)
                    }
                }
        }
    }
    private func pair() async {
        pairing = true
        defer { pairing = false }
        do {
            let link = try SecurePairingLink(text)
            guard let key = runtime.key else {
                throw TransportFailure.invalid("The device key is not ready. Try again.")
            }
            var request = URLRequest(url: link.endpoint)
            request.httpMethod = "POST"
            request.timeoutInterval = 30
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONValue.object([
                "token": .string(link.token), "publicKey": .string(key.publicKey), "label": .string("Ruimte on iOS"),
            ]).encoded()
            let network = URLSession(configuration: .ephemeral, delegate: PairingRedirects(), delegateQueue: nil)
            defer { network.invalidateAndCancel() }
            let (data, response) = try await network.data(for: request)
            guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
                throw TransportFailure.invalid("The machine refused this link. It may be used or expired.")
            }
            let result = try WireSchema.validate("PairResultSchema", JSONValue.decode(data))
            guard let endpoint = result["endpoint"], let publicKey = endpoint["publicKey"]?.stringValue,
                let broker = endpoint["brokerUrl"]?.stringValue, let brokerURL = URL(string: broker),
                brokerURL.scheme == "wss"
            else {
                throw TransportFailure.invalid(
                    "Pairing succeeded, but this machine needs a public key and secure broker before iOS can connect.")
            }
            let value = JSONValue.object([
                "id": endpoint["id"]!, "name": .string(endpoint.text("label")), "publicKey": .string(publicKey),
                "brokerUrl": .string(broker), "icon": endpoint["icon"] ?? .null, "lastSeenAt": .null,
            ])
            let machine = try JSONDecoder().decode(Machine.self, from: value.encoded())
            UserDefaultsPairingStore().insert(
                PairingIdentity(machineID: machine.id, machineKey: machine.publicKey, clientKey: key.publicKey))
            runtime.addPairedMachine(machine)
            dismiss()
        } catch { problem = error.localizedDescription }
    }
}
