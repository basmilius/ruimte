import Foundation

public struct PushAPI: Sendable {
    public let baseURL: URL
    private let fetch: AddressBookClient.Fetch
    public init(baseURL: URL = URL(string: WireConstants.addressBookURL)!, fetch: AddressBookClient.Fetch? = nil) {
        self.baseURL = baseURL
        self.fetch =
            fetch ?? { request in
                let (data, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse else { throw PushCryptoError.invalid }
                return (data, http)
            }
    }
    public func register(token: String, environment: String, accessToken: String) async throws -> String {
        let payload = try WireSchema.validate(
            "PushRegisterDevicePayloadSchema", .object(["token": .string(token), "environment": .string(environment)]))
        let data = try await call("POST", path: "/v1/push/devices", body: payload, accessToken: accessToken)
        return try JSONDecoder().decode(PushRegisterDeviceResult.self, from: data).handle
    }
    public func activity(handle: String, machineID: String, collapseID: String, token: String?, accessToken: String)
        async throws
    {
        let payload = try WireSchema.validate(
            "PushActivityRegistrationSchema",
            .object([
                "machineId": .string(machineID), "collapseId": .string(collapseID),
                "token": token.map(JSONValue.string) ?? .null,
            ]))
        _ = try await call(
            "PUT", path: "/v1/push/devices/\(handle)/activities", body: payload, accessToken: accessToken)
    }
    public func startActivity(handle: String, token: String?, accessToken: String) async throws {
        let payload = try WireSchema.validate(
            "PushStartActivityRegistrationSchema", .object(["token": token.map(JSONValue.string) ?? .null]))
        _ = try await call(
            "PUT", path: "/v1/push/devices/\(handle)/start-activity", body: payload, accessToken: accessToken)
    }
    public func remove(handle: String, accessToken: String) async throws {
        _ = try await call("DELETE", path: "/v1/push/devices/\(handle)", body: nil, accessToken: accessToken)
    }
    private func call(_ method: String, path: String, body: JSONValue?, accessToken: String) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL), url.scheme == "https", url.user == nil,
            url.password == nil
        else { throw PushCryptoError.invalid }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = try body.encoded()
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await fetch(request)
        guard (200..<300).contains(response.statusCode) else {
            let json = try? JSONValue.decode(data)
            throw AddressBookRequestError(
                code: json?["error"]?["code"]?.stringValue ?? "push", status: response.statusCode,
                message: json?["error"]?["message"]?.stringValue ?? "Notifications could not be registered.")
        }
        return data
    }
}
