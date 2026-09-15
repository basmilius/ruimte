import Foundation

public protocol NativeAppleAPI: Sendable {
    func startApple(_ payload: NativeAppleStartPayload) async throws -> NativeAppleStartResult
    func completeApple(_ payload: NativeAppleCompletePayload) async throws -> NativeAppleCompleteResult
}

enum NativeAppleLoginError: Error, LocalizedError, Equatable {
    case unavailable, expired, invalidCredential, wrongState

    var errorDescription: String? {
        switch self {
        case .unavailable: "Apple sign-in is not available right now. Try again later or sign in with GitHub."
        case .expired: "This Apple sign-in expired. Please try again."
        case .invalidCredential: "Apple returned an incomplete sign-in response. Please try again."
        case .wrongState: "Apple's response does not belong to this sign-in. Please try again."
        }
    }
}

struct NativeAppleCredential: Sendable {
    let state: String?
    let identityToken: Data?
    let authorizationCode: Data?

    func payload(for attempt: String) throws -> NativeAppleCompletePayload {
        guard state == attempt else { throw NativeAppleLoginError.wrongState }
        guard let identityToken, let authorizationCode,
            let identity = String(data: identityToken, encoding: .utf8),
            let code = String(data: authorizationCode, encoding: .utf8)
        else { throw NativeAppleLoginError.invalidCredential }
        let payload = NativeAppleCompletePayload(attempt: attempt, identityToken: identity, authorizationCode: code)
        do { return try validatedAppleValue(payload) } catch { throw NativeAppleLoginError.invalidCredential }
    }
}

private func validatedAppleValue<Value: Codable>(_ value: Value) throws -> Value {
    try JSONDecoder().decode(Value.self, from: JSONEncoder().encode(value))
}

@MainActor
final class NativeAppleSignIn {
    typealias Authorize = @MainActor (NativeAppleStartResult) async throws -> NativeAppleCredential
    private let authorize: Authorize
    private let now: @Sendable () -> Int64
    private let operation = SignInOperation()

    init(
        authorize: @escaping Authorize,
        now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }
    ) {
        self.authorize = authorize
        self.now = now
    }

    func signIn(client: any NativeAppleAPI, vault: SessionVault, label: String) async throws -> SessionView {
        do {
            return try await operation.perform(onCancelledResult: { await vault.discard(accessToken: $0.accessToken) })
            {
                let pkce = try PKCELogin()
                let challenge = try validatedAppleValue(await client.startApple(.init(codeChallenge: pkce.challenge)))
                try Task.checkCancellation()
                guard challenge.expiresAt > self.now() else { throw NativeAppleLoginError.expired }
                let credential = try await self.authorize(challenge)
                try Task.checkCancellation()
                guard challenge.expiresAt > self.now() else { throw NativeAppleLoginError.expired }
                let result = try validatedAppleValue(
                    await client.completeApple(credential.payload(for: challenge.attempt)))
                try Task.checkCancellation()
                return try await vault.exchange(
                    SessionLoginCode(
                        code: result.code, codeVerifier: pkce.verifier, redirectUri: PKCELogin.redirectURI,
                        label: boundedDeviceLabel(label)))
            }
        } catch is CancellationError {
            throw LoginError.cancelled
        } catch let error as AddressBookRequestError where [404, 405, 501, 503].contains(error.status) {
            throw NativeAppleLoginError.unavailable
        }
    }

    func cancel() { operation.cancel() }
}

#if canImport(UIKit)
    import AuthenticationServices
    import UIKit

    @MainActor
    public final class NativeAppleAuthentication: NSObject, ASAuthorizationControllerDelegate,
        ASAuthorizationControllerPresentationContextProviding
    {
        private let anchor: UIWindow
        private var controller: ASAuthorizationController?
        private var pending: CheckedContinuation<NativeAppleCredential, Error>?
        private var presentationID: UUID?
        private lazy var flow = NativeAppleSignIn { [weak self] challenge in
            guard let self else { throw LoginError.cancelled }
            return try await self.authorize(challenge)
        }

        public init(anchor: UIWindow) { self.anchor = anchor }

        public func signIn(client: AddressBookClient, vault: SessionVault, label: String) async throws -> SessionView {
            try await flow.signIn(client: client, vault: vault, label: label)
        }

        public func cancel() {
            flow.cancel()
            cancelPresentation()
        }

        private func cancelPresentation() {
            let controller = controller
            finish(.failure(LoginError.cancelled))
            controller?.cancel()
        }

        public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { anchor }

        private func authorize(_ challenge: NativeAppleStartResult) async throws -> NativeAppleCredential {
            cancelPresentation()
            let identifier = UUID()
            return try await withTaskCancellationHandler {
                try Task.checkCancellation()
                return try await withCheckedThrowingContinuation { continuation in
                    presentationID = identifier
                    pending = continuation
                    let request = ASAuthorizationAppleIDProvider().createRequest()
                    request.requestedScopes = []
                    request.state = challenge.attempt
                    // The server checks this literal nonce against Apple's signed identity token.
                    request.nonce = challenge.nonce
                    let controller = ASAuthorizationController(authorizationRequests: [request])
                    self.controller = controller
                    controller.delegate = self
                    controller.presentationContextProvider = self
                    controller.performRequests()
                }
            } onCancel: {
                Task { @MainActor [weak self] in
                    if self?.presentationID == identifier { self?.cancelPresentation() }
                }
            }
        }

        public func authorizationController(
            controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization
        ) {
            guard controller === self.controller else { return }
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
                finish(.failure(NativeAppleLoginError.invalidCredential))
                return
            }
            finish(
                .success(
                    NativeAppleCredential(
                        state: credential.state, identityToken: credential.identityToken,
                        authorizationCode: credential.authorizationCode)))
        }

        public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
            guard controller === self.controller else { return }
            if (error as? ASAuthorizationError)?.code == .canceled {
                finish(.failure(LoginError.cancelled))
            } else {
                finish(.failure(NativeAppleLoginError.unavailable))
            }
        }

        private func finish(_ result: Result<NativeAppleCredential, Error>) {
            let continuation = pending
            pending = nil
            presentationID = nil
            controller?.delegate = nil
            controller?.presentationContextProvider = nil
            controller = nil
            continuation?.resume(with: result)
        }
    }
#endif
