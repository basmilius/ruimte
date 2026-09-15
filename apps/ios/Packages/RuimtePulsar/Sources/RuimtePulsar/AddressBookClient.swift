import Foundation

public struct AddressBookRequestError: Error, LocalizedError, Sendable {
    public let code: String
    public let status: Int
    public let message: String

    public init(code: String, status: Int, message: String) {
        self.code = code
        self.status = status
        self.message = message
    }

    public var errorDescription: String? { message }
}

public protocol SessionAPI: Sendable {
    func exchange(_ payload: SessionExchangePayload) async throws -> SessionResult
    func refresh(_ payload: SessionRefreshPayload) async throws -> SessionResult
    func endSession(accessToken: String) async throws
}

public struct AddressBookClient: SessionAPI, NativeAppleAPI, Sendable {
    public typealias Fetch = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)
    public let baseURL: URL
    private let fetch: Fetch
    private static let networkSession = URLSession(configuration: connectionConfiguration())

    static func connectionConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForResource = 60
        return configuration
    }

    public init(baseURL: URL = URL(string: WireConstants.addressBookURL)!, fetch: Fetch? = nil) {
        self.baseURL = baseURL
        self.fetch =
            fetch ?? { request in
                let (data, response) = try await Self.networkSession.data(for: request)
                guard let response = response as? HTTPURLResponse else {
                    throw AddressBookRequestError(
                        code: "bad-answer", status: 0, message: "The address book returned no HTTP response.")
                }
                return (data, response)
            }
    }

    public func exchange(_ payload: SessionExchangePayload) async throws -> SessionResult {
        try await call("POST", path: "/v1/session", body: JSONEncoder().encode(payload))
    }

    public func refresh(_ payload: SessionRefreshPayload) async throws -> SessionResult {
        try await call("POST", path: "/v1/session/refresh", body: JSONEncoder().encode(payload))
    }

    public func startApple(_ payload: NativeAppleStartPayload) async throws -> NativeAppleStartResult {
        let body = try JSONEncoder().encode(payload)
        _ = try JSONDecoder().decode(NativeAppleStartPayload.self, from: body)
        return try await call("POST", path: "/v1/apple/start", body: body)
    }

    public func completeApple(_ payload: NativeAppleCompletePayload) async throws -> NativeAppleCompleteResult {
        let body = try JSONEncoder().encode(payload)
        _ = try JSONDecoder().decode(NativeAppleCompletePayload.self, from: body)
        return try await call("POST", path: "/v1/apple/complete", body: body)
    }

    public func endSession(accessToken: String) async throws {
        _ = try await response("DELETE", path: "/v1/session", token: accessToken)
    }

    public func providers() async throws -> [String] {
        let result: ProvidersResult = try await call("GET", path: "/v1/providers")
        return result.providers
    }

    public func listMachines(accessToken: String) async throws -> MachineListResult {
        try await call("GET", path: "/v1/machines", token: accessToken)
    }

    public func requestStatement(accessToken: String, payload: AccessRequestPayload) async throws -> AccessStatement {
        try await call("POST", path: "/v1/statements", token: accessToken, body: JSONEncoder().encode(payload))
    }

    public func signalAccess(accessToken: String, machineID: String, key: any SessionSigner, label: String) async throws
        -> SignalAccess
    {
        let nonce = try Base64URL.randomToken(bytes: 18)
        let signature = try key.sign(
            SigningBytes.accessRequest(machineID: machineID, publicKey: key.publicKey, nonce: nonce))
        let statement = try await requestStatement(
            accessToken: accessToken,
            payload: AccessRequestPayload(
                machineId: machineID, clientPublicKey: key.publicKey, nonce: nonce, signature: signature
            ))
        guard statement.machineId == machineID, statement.clientPublicKey == key.publicKey, statement.nonce == nonce
        else {
            throw AddressBookRequestError(
                code: "bad-answer", status: 200, message: "Your account answered with a statement for something else.")
        }
        return SignalAccess(statement: statement, label: boundedDeviceLabel(label))
    }

    private func call<Result: Decodable>(_ method: String, path: String, token: String? = nil, body: Data? = nil)
        async throws -> Result
    {
        let (data, response) = try await response(method, path: path, token: token, body: body)
        do {
            return try JSONDecoder().decode(Result.self, from: data)
        } catch {
            throw AddressBookRequestError(
                code: "bad-answer", status: response.statusCode,
                message: "The address book answered with something this client cannot read.")
        }
    }

    private func response(_ method: String, path: String, token: String? = nil, body: Data? = nil) async throws -> (
        Data, HTTPURLResponse
    ) {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL, url.scheme == "https", url.user == nil,
            url.password == nil
        else {
            throw AddressBookRequestError(
                code: "bad-request", status: 0, message: "The address book needs an HTTPS address.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.timeoutInterval = 30
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
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
        } catch let error as AddressBookRequestError {
            throw error
        } catch {
            throw AddressBookRequestError(code: "network", status: 0, message: "The address book could not be reached.")
        }
        guard (200..<300).contains(response.statusCode) else {
            if let failure = try? JSONDecoder().decode(AddressBookError.self, from: data) {
                throw AddressBookRequestError(
                    code: failure.error.code.rawValue, status: response.statusCode, message: failure.error.message)
            }
            throw AddressBookRequestError(
                code: "bad-answer", status: response.statusCode,
                message: "The address book answered \(response.statusCode).")
        }
        return (data, response)
    }
}
