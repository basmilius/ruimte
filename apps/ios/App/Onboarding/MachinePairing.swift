import Foundation
import Observation
import RuimtePulsar
import RuimteTransport
import UIKit

/// The pairing sheet's link, from the person or the clipboard, and the one attempt to pair with it.
@MainActor @Observable
final class MachinePairing {
    var text = "" {
        didSet {
            if text != oldValue {
                problem = nil
                fromClipboard = false
            }
        }
    }
    var problem: String?
    private(set) var pairing = false
    private(set) var fromClipboard = false

    var canPair: Bool { !pairing && (try? SecurePairingLink(text)) != nil }

    /// Fills in a pairing link the clipboard holds, unless something was typed already.
    func readClipboard(_ pasteboard: some PairingPasteboard = SystemPairingPasteboard()) async {
        guard text.isEmpty, let link = await PairingClipboard.link(in: pasteboard), text.isEmpty else { return }
        text = link
        fromClipboard = true
    }

    /// Pairs with the link and adds the machine; true once it is there.
    func pair(runtime: AppRuntime, client: PairingClient = PairingClient()) async -> Bool {
        guard !pairing else { return false }
        pairing = true
        defer { pairing = false }
        do {
            let link = try SecurePairingLink(text)
            guard let key = runtime.key else {
                throw PairingFailure(code: "no-key", message: "The device key is not ready. Try again.")
            }
            let result = try await client.pair(link, publicKey: key.publicKey, label: "Ruimte on iOS")
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
            return true
        } catch is CancellationError {
            return false
        } catch {
            problem = error.localizedDescription
            return false
        }
    }
}

@MainActor
protocol PairingPasteboard {
    /// Whether the clipboard looks like it holds a web address, asked without the system's paste prompt.
    func holdsWebAddress() async -> Bool
    /// The clipboard's text; reading it is what asks the person to allow pasting.
    func text() -> String?
}

struct SystemPairingPasteboard: PairingPasteboard {
    func holdsWebAddress() async -> Bool {
        await withCheckedContinuation { continuation in
            UIPasteboard.general.detectPatterns(for: [\UIPasteboard.DetectedValues.probableWebURL]) { result in
                continuation.resume(returning: (try? result.get())?.contains(\.probableWebURL) == true)
            }
        }
    }

    func text() -> String? { UIPasteboard.general.string }
}

enum PairingClipboard {
    /// The pairing link on the clipboard. Only a clipboard that looks like a web address is read, so text of any other
    /// kind never raises the paste prompt.
    @MainActor static func link(in pasteboard: some PairingPasteboard) async -> String? {
        guard await pasteboard.holdsWebAddress(),
            let value = pasteboard.text()?.trimmingCharacters(in: .whitespacesAndNewlines),
            (try? SecurePairingLink(value)) != nil
        else {
            return nil
        }
        return value
    }
}
