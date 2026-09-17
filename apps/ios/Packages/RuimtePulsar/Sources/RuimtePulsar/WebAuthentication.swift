import Foundation

@MainActor
final class SignInOperation {
    private var running: Task<SessionView, Error>?
    private var identifier: UUID?

    func perform(
        onCancelledResult: @escaping @MainActor (SessionView) async -> Void = { _ in },
        _ action: @escaping @MainActor () async throws -> SessionView
    ) async throws -> SessionView {
        try Task.checkCancellation()
        cancel()
        let identifier = UUID()
        self.identifier = identifier
        let task = Task { try await action() }
        running = task
        defer {
            if self.identifier == identifier {
                running = nil
                self.identifier = nil
            }
        }
        return try await withTaskCancellationHandler {
            do {
                let result = try await task.value
                guard !task.isCancelled else {
                    #if os(iOS)
                        await withTaskCancellationShield {
                            await onCancelledResult(result)
                        }
                    #else
                        // Cancellation shields require macOS 27, while this package still supports macOS 15.
                        await Task { await onCancelledResult(result) }.value
                    #endif
                    throw CancellationError()
                }
                return result
            } catch {
                if task.isCancelled { throw CancellationError() }
                throw error
            }
        } onCancel: {
            task.cancel()
        }
    }

    func cancel() {
        running?.cancel()
        running = nil
        identifier = nil
    }
}

#if canImport(UIKit)
    import AuthenticationServices
    import UIKit

    @MainActor
    public final class WebAuthentication: NSObject, ASWebAuthenticationPresentationContextProviding {
        private let anchor: UIWindow
        private var session: ASWebAuthenticationSession?
        private var pending: CheckedContinuation<URL, Error>?
        private var attempt: UUID?
        private let operation = SignInOperation()

        public init(anchor: UIWindow) {
            self.anchor = anchor
        }

        public func signIn(provider: ProviderId, client: AddressBookClient, vault: SessionVault, label: String)
            async throws -> SessionView
        {
            do {
                return try await operation.perform(onCancelledResult: {
                    await vault.discard(accessToken: $0.accessToken)
                }) {
                    let login = try PKCELogin()
                    let url = try login.startURL(baseURL: client.baseURL, provider: provider)
                    let callback = try await self.authenticate(url)
                    try Task.checkCancellation()
                    return try await vault.exchange(login.loginCode(callback: callback, label: label))
                }
            } catch is CancellationError {
                throw LoginError.cancelled
            }
        }

        public func cancel() {
            operation.cancel()
            cancelBrowser()
        }

        private func cancelBrowser() {
            let session = session
            finish(.failure(LoginError.cancelled))
            session?.cancel()
        }

        public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
            anchor
        }

        private func authenticate(_ url: URL) async throws -> URL {
            cancelBrowser()
            let identifier = UUID()
            return try await withTaskCancellationHandler {
                try Task.checkCancellation()
                return try await withCheckedThrowingContinuation { continuation in
                    attempt = identifier
                    pending = continuation
                    let session = ASWebAuthenticationSession(url: url, callback: .customScheme("ruimte")) {
                        [weak self] callback, error in
                        Task { @MainActor in
                            guard let self, self.attempt == identifier else {
                                return
                            }
                            if let callback {
                                self.finish(.success(callback))
                            } else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                                self.finish(.failure(LoginError.cancelled))
                            } else {
                                self.finish(.failure(error ?? LoginError.unavailable))
                            }
                        }
                    }
                    self.session = session
                    session.presentationContextProvider = self
                    if !session.start() {
                        finish(.failure(LoginError.unavailable))
                    }
                }
            } onCancel: {
                Task { @MainActor [weak self] in
                    if self?.attempt == identifier {
                        self?.cancelBrowser()
                    }
                }
            }
        }

        private func finish(_ result: Result<URL, Error>) {
            let continuation = pending
            pending = nil
            attempt = nil
            session = nil
            continuation?.resume(with: result)
        }
    }
#endif
