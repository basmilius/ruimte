import RuimtePulsar
import SwiftUI
import UIKit

/// The two ways in: an account through one of the providers, or a pairing link straight to a computer.
struct WelcomePage: View {
    @Bindable var runtime: AppRuntime
    let window: UIWindow?
    let pair: () -> Void
    /// Called as a person takes either way in, before it starts.
    var begin: () -> Void = {}
    @State private var retrying = false
    @State private var chosen: ProviderId?
    @State private var eclipseAnchor: CGFloat?

    private var busy: Bool { runtime.loading || runtime.signingIn || runtime.signingOut || retrying }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 72)
                    introduction
                    Spacer(minLength: 48)
                    VStack(spacing: 12) {
                        signInOptions
                        pairingOption
                    }
                }
                .frame(maxWidth: 420)
                .frame(maxWidth: .infinity, minHeight: geometry.size.height)
                .padding(.horizontal, 20)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background {
            ZStack {
                MobileStyle.canvas
                Eclipse(scene: .welcome, anchor: eclipseAnchor)
            }
            .ignoresSafeArea()
        }
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
        VStack(spacing: 8) {
            AppIconImage(size: 104).eclipseAnchor($eclipseAnchor)
            Text("Ruimte")
                .font(.largeTitle.weight(.bold))
                .padding(.top, 20)
                .accessibilityAddTraits(.isHeader)
            Text("Space for AI Engineering.")
                .font(.body)
                .foregroundStyle(MobileStyle.text.opacity(0.8))
            Text("Pick up your projects and check in on your agents.")
                .font(.subheadline)
                .foregroundStyle(MobileStyle.muted)
                .padding(.top, 20)
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var signInOptions: some View {
        if runtime.loading || retrying {
            MobileLoadingRow("Loading sign-in options")
                .frame(maxWidth: .infinity, minHeight: 56)
        } else if runtime.providers.isEmpty {
            VStack(spacing: 4) {
                Text("Account sign-in is unavailable right now.")
                    .font(.subheadline)
                    .foregroundStyle(MobileStyle.muted)
                    .multilineTextAlignment(.center)
                Button("Try again", action: retry)
                    .frame(minHeight: 44)
                    .disabled(busy)
            }
        } else {
            ForEach([ProviderId.apple, .github].filter(runtime.providers.contains), id: \.rawValue) { provider in
                ProviderAccountButton(
                    provider: provider, signingIn: runtime.signingIn && chosen == provider,
                    enabled: !busy && window != nil
                ) {
                    signIn(provider)
                }
            }
        }
    }

    private var pairingOption: some View {
        Button {
            begin()
            pair()
        } label: {
            Label("Connect directly to your computer", lucideIcon: "link", iconSize: 15)
                .font(.subheadline)
                .foregroundStyle(MobileStyle.text.opacity(0.8))
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(.rect)
        }
        .buttonStyle(WelcomeActionStyle())
        .disabled(runtime.signingIn || runtime.signingOut)
        .padding(.bottom, 8)
        .accessibilityIdentifier("welcome.pair")
    }

    private func signIn(_ provider: ProviderId) {
        guard let window, !busy else { return }
        begin()
        chosen = provider
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

/// Apple's button is solid, as its guidelines ask; GitHub's is glass beside it.
private struct ProviderAccountButton: View {
    let provider: ProviderId
    let signingIn: Bool
    let enabled: Bool
    let action: () -> Void
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var height = 56
    @ScaledMetric(relativeTo: .body) private var logoSize = 19

    private var apple: Bool { provider == .apple }
    private var title: String { apple ? "Continue with Apple" : "Continue with GitHub" }
    private var solidFill: Color { colorScheme == .dark ? .white : .black }
    private var solidText: Color { colorScheme == .dark ? .black : .white }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if signingIn {
                    ProgressView().tint(apple ? solidText : MobileStyle.text)
                } else {
                    // The provider marks of the desktop's sign-in buttons.
                    Image(apple ? "AppleMark" : "GitHubMark")
                        .renderingMode(.template).resizable().scaledToFit()
                        .frame(width: logoSize, height: logoSize)
                        .accessibilityHidden(true)
                }
                Text(title).font(.body.weight(.semibold))
            }
            .foregroundStyle(apple ? solidText : MobileStyle.text)
            .frame(maxWidth: .infinity, minHeight: height)
            .background {
                if apple {
                    Capsule().fill(solidFill)
                }
            }
            .glassEffect(apple ? .identity : .regular.interactive(), in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(WelcomeActionStyle())
        .disabled(!enabled)
        .accessibilityLabel(title)
        .accessibilityIdentifier("welcome.sign-in.\(provider.rawValue)")
    }
}
