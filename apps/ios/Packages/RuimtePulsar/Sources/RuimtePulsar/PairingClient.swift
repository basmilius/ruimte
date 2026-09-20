import Foundation

/// What went wrong while pairing, in the words the page shows.
public struct PairingFailure: Error, LocalizedError, Sendable {
    public let code: String
    public let message: String

    public init(code: String, message: String) {
        self.code = code
        self.message = message
    }

    public var errorDescription: String? { message }
}

/// A pairing link as a person pastes it: `https://<host>/pair#<token>`. The token is good once and belongs to that
/// origin alone, so every other shape of address is refused here rather than on the way out.
public struct SecurePairingLink: Equatable, Sendable {
    public let endpoint: URL
    public let token: String

    public init(_ text: String) throws {
        guard var url = URLComponents(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
            url.scheme == "https", url.host?.isEmpty == false, url.user == nil, url.password == nil,
            url.path == "/pair", url.query == nil, let token = url.fragment, !token.isEmpty
        else {
            throw PairingFailure(code: "bad-link", message: "Paste an HTTPS pairing link ending in /pair#token.")
        }
        self.token = token
        url.path = "/auth/pair"
        url.fragment = nil
        guard let endpoint = url.url else {
            throw PairingFailure(code: "bad-link", message: "This pairing address is invalid.")
        }
        self.endpoint = endpoint
    }
}

/// A pairing token belongs only to the origin the person pasted, so a redirect ends the attempt instead of carrying
/// the token somewhere else.
private final class PairingRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

/// Pairs this device with one machine, over the machine's own address rather than the address book's. It has the same
/// `Fetch` seam as `AddressBookClient`, so the path can be tested without a network, and the same handling of a
/// cancelled attempt: a person who backs out gets no error to read.
public struct PairingClient: Sendable {
    public typealias Fetch = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)
    private let fetch: Fetch

    public init(fetch: Fetch? = nil) {
        self.fetch = fetch ?? Self.overOwnSession
    }

    /// A session of its own per attempt: it carries the redirect refusal and keeps nothing after the answer.
    private static let overOwnSession: Fetch = { request in
        let session = URLSession(configuration: .ephemeral, delegate: PairingRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw PairingFailure(code: "bad-answer", message: "The machine returned no HTTP response.")
        }
        return (data, response)
    }

    public func pair(_ link: SecurePairingLink, publicKey: String, label: String) async throws -> PairResult {
        var request = URLRequest(url: link.endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(
            PairPayload(token: link.token, label: label, publicKey: publicKey))
        let data: Data
        let response: HTTPURLResponse
        do {
            try Task.checkCancellation()
            (data, response) = try await fetch(request)
            try Task.checkCancellation()
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch let error as PairingFailure {
            throw error
        } catch {
            throw PairingFailure(code: "network", message: "The machine could not be reached.")
        }
        guard (200..<300).contains(response.statusCode) else {
            throw PairingFailure(
                code: "refused", message: "The machine refused this link. It may be used or expired.")
        }
        do {
            // The generated decoder validates the whole answer against `PairResultSchema` on its way in.
            return try JSONDecoder().decode(PairResult.self, from: data)
        } catch {
            throw PairingFailure(
                code: "bad-answer", message: "The machine answered with something this app cannot read.")
        }
    }
}

extension PairResultEndpoint {
    /// The machine this endpoint stands for, or nil while it lacks what a phone needs to reach it: a public key and a
    /// secure broker.
    public func pairedMachine() -> Machine? {
        guard let publicKey, case .value(let brokerUrl) = brokerUrl, URL(string: brokerUrl)?.scheme == "wss" else {
            return nil
        }
        return Machine(
            id: id, name: label, icon: machineIcon, publicKey: publicKey, brokerUrl: brokerUrl, lastSeenAt: nil)
    }

    private var machineIcon: MachineIcon? {
        guard case .value(let icon) = icon else { return nil }
        return MachineIcon(value: icon.value.rawValue)
    }
}
