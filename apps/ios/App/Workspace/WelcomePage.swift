import AuthenticationServices
import RuimtePulsar
import SwiftUI
import UIKit

struct WelcomePage: View {
    @Bindable var runtime: AppRuntime
    let window: UIWindow?
    let pair: () -> Void
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var buttonHeight = 54
    @State private var retrying = false

    private var busy: Bool { runtime.loading || runtime.signingIn || runtime.signingOut || retrying }
    private var buttonFill: Color { colorScheme == .dark ? .white : .black }
    private var buttonText: Color { colorScheme == .dark ? .black : .white }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 36) {
                    introduction
                    VStack(spacing: 24) {
                        signInOptions
                        pairingOption
                    }
                    Text("Projects and sessions stay on your computer.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: 420)
                .frame(maxWidth: .infinity, minHeight: max(0, geometry.size.height - 64))
                .padding(.horizontal, 24)
                .padding(.vertical, 32)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background(MobileStyle.canvas)
        .alert(
            "Sign-in failed",
            isPresented: Binding(
                get: { runtime.problem != nil },
                set: { if !$0 { runtime.problem = nil } }
            ), presenting: runtime.problem
        ) { _ in
            Button("OK", role: .cancel) { runtime.problem = nil }
        } message: { problem in
            Text(problem)
        }
    }

    private var introduction: some View {
        VStack(spacing: 28) {
            VStack(spacing: 12) {
                Image("RuimteLogo")
                    .renderingMode(.original)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 76, height: 76)
                    .padding(16)
                    .background(.white, in: RoundedRectangle(cornerRadius: 28))
                    .accessibilityHidden(true)
                Text("Ruimte")
                    .font(.title2.weight(.semibold))
            }
            VStack(spacing: 14) {
                Text("Space for AI Engineering")
                    .font(.largeTitle.weight(.bold))
                    .accessibilityAddTraits(.isHeader)
                Text("Pick up your projects and check in on your agents.")
                    .font(.body)
                    .foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var signInOptions: some View {
        VStack(spacing: 12) {
            if runtime.loading || retrying {
                ProgressView("Loading sign-in options")
                    .frame(maxWidth: .infinity, minHeight: buttonHeight)
            } else {
                if runtime.providers.contains(.apple) {
                    AppleAccountButton(dark: colorScheme == .dark, enabled: !busy && window != nil) {
                        signIn(.apple)
                    }
                    .id(colorScheme)
                    .frame(height: buttonHeight)
                }
                if runtime.providers.contains(.github) {
                    Button {
                        signIn(.github)
                    } label: {
                        HStack(spacing: 10) {
                            // Official mark: https://brand.github.com/foundations/logo
                            Image("GitHubMark")
                                .resizable()
                                .scaledToFit()
                                .frame(width: 24, height: 24)
                                .accessibilityHidden(true)
                            Text("Sign in with GitHub")
                                .font(.body.weight(.medium))
                        }
                        .foregroundStyle(buttonText)
                        .frame(maxWidth: .infinity, minHeight: buttonHeight)
                        .background(buttonFill, in: RoundedRectangle(cornerRadius: 12))
                        .contentShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(WelcomeActionStyle())
                    .disabled(busy || window == nil)
                }
                if runtime.providers.isEmpty {
                    Text("Account sign-in is unavailable right now.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("Try again", action: retry)
                        .frame(minHeight: 44)
                        .disabled(busy)
                }
            }
        }
    }

    private var pairingOption: some View {
        VStack(spacing: 12) {
            HStack(spacing: 16) {
                Rectangle().fill(MobileStyle.border).frame(height: 1)
                Text("or").font(.footnote).foregroundStyle(.secondary)
                Rectangle().fill(MobileStyle.border).frame(height: 1)
            }
            .padding(.bottom, 8)
            Button(action: pair) {
                Label("Use a pairing link", systemImage: "link")
                    .font(.body.weight(.medium))
                    .frame(maxWidth: .infinity, minHeight: buttonHeight)
                    .background(MobileStyle.surface, in: RoundedRectangle(cornerRadius: 12))
                    .contentShape(RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(WelcomeActionStyle())
            .foregroundStyle(MobileStyle.accent)
            .disabled(runtime.signingIn || runtime.signingOut)
            Text("Connect directly to your computer.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private func signIn(_ provider: ProviderId) {
        guard let window, !busy else { return }
        Task { await runtime.signIn(provider, window: window) }
    }

    private func retry() {
        guard !busy else { return }
        retrying = true
        Task {
            defer { retrying = false }
            if runtime.key == nil {
                await runtime.start()
            } else {
                do {
                    runtime.providers = try await runtime.client.providers().compactMap(ProviderId.init(rawValue:))
                    runtime.problem = nil
                } catch {
                    runtime.problem = error.localizedDescription
                }
            }
        }
    }
}

private struct WelcomeActionStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(!enabled ? 0.5 : configuration.isPressed ? 0.75 : 1)
    }
}

private struct AppleAccountButton: UIViewRepresentable {
    let dark: Bool
    let enabled: Bool
    let action: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(action: action) }

    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(type: .signIn, style: dark ? .white : .black)
        button.cornerRadius = 12
        button.addTarget(context.coordinator, action: #selector(Coordinator.signIn), for: .touchUpInside)
        return button
    }

    func updateUIView(_ button: ASAuthorizationAppleIDButton, context: Context) {
        context.coordinator.action = action
        button.isEnabled = enabled
        button.alpha = enabled ? 1 : 0.5
    }

    @MainActor final class Coordinator: NSObject {
        var action: () -> Void
        init(action: @escaping () -> Void) { self.action = action }
        @objc func signIn() { action() }
    }
}
