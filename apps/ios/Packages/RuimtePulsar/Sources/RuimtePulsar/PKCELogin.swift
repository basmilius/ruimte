import CryptoKit
import Foundation

public enum LoginError: Error, LocalizedError, Equatable, Sendable {
    case invalidCallback
    case wrongState
    case cancelled
    case missingCode
    case provider(String)
    case unavailable

    public var errorDescription: String? {
        switch self {
        case .invalidCallback: return "The browser returned to an unexpected address. Try signing in again."
        case .wrongState: return "The answer from the browser does not belong to this sign-in. Try again."
        case .cancelled: return "Signing in was canceled."
        case .missingCode: return "The browser came back without a valid sign-in code. Try again."
        case .provider(let code): return "Signing in did not work (\(code))."
        case .unavailable: return "The sign-in browser could not open. Try again."
        }
    }
}

public struct PKCELogin: Sendable {
    public static let redirectURI = WireConstants.appRedirectURI
    public let verifier: String
    public let state: String

    public init() throws {
        verifier = try Base64URL.randomToken()
        state = try Base64URL.randomToken(bytes: 24)
    }

    public init(verifier: String, state: String) {
        self.verifier = verifier
        self.state = state
    }

    public var challenge: String {
        Base64URL.encode(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    public func startURL(baseURL: URL, provider: ProviderId) throws -> URL {
        guard baseURL.scheme == "https", baseURL.user == nil, baseURL.password == nil,
              let route = URL(string: "/auth/\(provider.rawValue)/start", relativeTo: baseURL),
              var components = URLComponents(url: route.absoluteURL, resolvingAgainstBaseURL: false) else {
            throw LoginError.unavailable
        }
        components.queryItems = [
            URLQueryItem(name: "redirect_uri", value: Self.redirectURI),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256")
        ]
        guard let url = components.url else {
            throw LoginError.unavailable
        }
        return url
    }

    public func loginCode(callback: URL, label: String) throws -> SessionLoginCode {
        guard let components = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              components.fragment == nil,
              callback.absoluteString.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first == Substring(Self.redirectURI) else {
            throw LoginError.invalidCallback
        }
        let items = components.queryItems ?? []
        guard items.filter({ $0.name == "state" }).count == 1,
              items.first(where: { $0.name == "state" })?.value == state else {
            throw LoginError.wrongState
        }
        let codes = items.filter { $0.name == "code" }
        let errors = items.filter { $0.name == "error" }
        guard codes.count <= 1, errors.count <= 1, codes.isEmpty || errors.isEmpty else {
            throw LoginError.invalidCallback
        }
        if let error = errors.first?.value {
            throw error == "access_denied" ? LoginError.cancelled : LoginError.provider(error)
        }
        guard let code = codes.first?.value, code.utf8.count == 43, Base64URL.decode(code)?.count == 32 else {
            throw LoginError.missingCode
        }
        return SessionLoginCode(code: code, codeVerifier: verifier, redirectUri: Self.redirectURI, label: boundedDeviceLabel(label))
    }
}
