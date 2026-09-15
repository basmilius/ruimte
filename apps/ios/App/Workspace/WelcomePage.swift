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
                        .foregroundStyle(MobileStyle.muted)
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
                Image(uiImage: UIImage(named: "RuimteLogo")?.withRenderingMode(.alwaysOriginal) ?? UIImage())
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
                    .foregroundStyle(MobileStyle.muted)
            }
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var signInOptions: some View {
        VStack(spacing: 12) {
            if runtime.loading || retrying {
                ProgressView().accessibilityLabel("Loading sign-in options")
                    .frame(maxWidth: .infinity, minHeight: buttonHeight)
            } else {
                if runtime.providers.contains(.apple) {
                    ProviderAccountButton(provider: .apple, enabled: !busy && window != nil) {
                        signIn(.apple)
                    }
                }
                if runtime.providers.contains(.github) {
                    ProviderAccountButton(provider: .github, enabled: !busy && window != nil) {
                        signIn(.github)
                    }
                }
                if runtime.providers.isEmpty {
                    Text("Account sign-in is unavailable right now.")
                        .font(.subheadline)
                        .foregroundStyle(MobileStyle.muted)
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
                Text("or").font(.footnote).foregroundStyle(MobileStyle.muted)
                Rectangle().fill(MobileStyle.border).frame(height: 1)
            }
            .padding(.bottom, 8)
            Button(action: pair) {
                Label("Use a pairing link", lucideIcon: "link")
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
                .foregroundStyle(MobileStyle.muted)
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

private struct ProviderAccountButton: View {
    let provider: ProviderId
    let enabled: Bool
    let action: () -> Void
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var visualHeight = 44
    @ScaledMetric(relativeTo: .body) private var logoSpacing = 10
    @ScaledMetric(relativeTo: .body) private var logoSize = 24

    private var buttonFill: Color { colorScheme == .dark ? .white : .black }
    private var buttonText: Color { colorScheme == .dark ? .black : .white }
    private var title: String { provider == .apple ? "Sign in with Apple" : "Sign in with GitHub" }

    var body: some View {
        Button(action: action) {
            HStack(spacing: logoSpacing) {
                // Reuse the provider marks from the desktop sign-in buttons.
                Image(provider == .apple ? "AppleMark" : "GitHubMark")
                    .renderingMode(.template).resizable().scaledToFit()
                    .frame(width: logoSize, height: logoSize)
                    .accessibilityHidden(true)
                Text(title).font(.body.weight(.medium))
            }
            .foregroundStyle(buttonText)
            .frame(maxWidth: .infinity, minHeight: visualHeight)
            .background(buttonFill, in: RoundedRectangle(cornerRadius: 12))
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(WelcomeActionStyle())
        .disabled(!enabled)
        .accessibilityLabel(title)
        .accessibilityIdentifier("welcome.sign-in.\(provider.rawValue)")
    }
}
