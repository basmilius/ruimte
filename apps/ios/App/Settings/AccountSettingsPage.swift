import RuimtePulsar
import SwiftUI
import UIKit

/// The account behind the top of Settings: who is signed in and how, the machines this phone reaches, signing out and
/// deleting the account.
struct AccountSettingsPage: View {
    let runtime: AppRuntime
    /// Closes the Settings sheet once the account is gone; nil where Settings is not a sheet.
    let closeSettings: (() -> Void)?
    @State private var confirmSignOut = false

    static func providerName(_ provider: ProviderId) -> String {
        switch provider {
        case .github: "GitHub"
        case .apple: "Apple"
        }
    }

    var body: some View {
        MobileForm {
            Section {
                VStack(spacing: 8) {
                    AccountPicture(account: runtime.account, size: 64)
                    Text(AccountAvatar.name(of: runtime.account) ?? "Not signed in").font(.title3.weight(.semibold))
                    if let account = runtime.account {
                        Text("Signed in with \(Self.providerName(account.provider))")
                            .font(.footnote).foregroundStyle(MobileStyle.muted)
                    } else {
                        Text("This phone reaches the machines it paired with a link.")
                            .font(.footnote).foregroundStyle(MobileStyle.muted).multilineTextAlignment(.center)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
                .accessibilityElement(children: .combine)
            }
            Section("Machines") {
                ForEach(runtime.machines, id: \.id) { machine in
                    MobileRow(
                        title: machine.name, subtitle: reach(runtime.session(for: machine)),
                        symbol: machine.icon?.value ?? "monitor")
                }
                if runtime.machines.isEmpty {
                    Text("No machines yet.").foregroundStyle(MobileStyle.muted)
                }
            }
            if let account = runtime.account {
                Section {
                    Button(role: .destructive) {
                        confirmSignOut = true
                    } label: {
                        Label("Sign out", lucideIcon: "log-out")
                    }
                    .disabled(runtime.signingOut)
                    .accessibilityIdentifier("settings.signOut")
                }
                Section {
                    NavigationLink {
                        DeleteAccountPage(model: deletion(account))
                    } label: {
                        Label("Delete account", lucideIcon: "trash").foregroundStyle(MobileStyle.statusError)
                    }
                    .accessibilityIdentifier("settings.deleteAccount")
                } footer: {
                    Text("Deletes this account and every sign-in to it. Your machines and their projects stay.")
                }
            }
        }
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Sign out on this device?", isPresented: $confirmSignOut) {
            Button("Sign out", role: .destructive) {
                Task {
                    await runtime.signOut()
                    closeSettings?()
                }
            }
        }
    }

    private func reach(_ session: SharedMachineSession) -> String {
        if session.connected { return session.relayed == true ? "Connected via relay" : "Connected" }
        return session.problem ?? "Not connected"
    }

    /// The window in front, which Sign in with Apple presents its sheet over.
    private static var keyWindow: UIWindow? {
        UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
            .first(where: \.isKeyWindow)
    }

    private func deletion(_ account: Account) -> AccountDeletionModel {
        AccountDeletionModel(
            account: account, api: runtime.client,
            accessToken: { [runtime] in try await runtime.vault?.accessToken() },
            appleCode: {
                guard let window = Self.keyWindow else { throw LoginError.cancelled }
                return try await NativeAppleAuthentication(anchor: window).authorizationCode()
            },
            signOut: { [runtime, closeSettings] in
                await runtime.signOut(accountDeleted: true)
                closeSettings?()
            })
    }
}
