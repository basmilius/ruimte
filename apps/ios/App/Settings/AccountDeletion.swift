import Observation
import RuimtePulsar
import SwiftUI

/// Deleting the Ruimte account, which App Store review asks an app that makes accounts to offer. The account is read
/// fresh from the address book, so the name to type and whether Apple has to revoke Sign in with Apple are what the
/// address book will check. Nothing is deleted until the typed name matches; with an Apple identity, a fresh Apple
/// authorization comes right before the request, since its code lives five minutes.
@MainActor @Observable final class AccountDeletionModel {
    typealias AccessToken = @MainActor () async throws -> String?
    typealias AppleCode = @MainActor () async throws -> String
    typealias SignOut = @MainActor () async -> Void

    private(set) var account: Account
    /// Whether an Apple identity is on the account, which makes the address book revoke it before it deletes.
    private(set) var usesApple: Bool
    var typed = ""
    private(set) var problem: String?
    private(set) var busy = false
    private(set) var deleted = false
    @ObservationIgnored private let api: any AccountAPI
    @ObservationIgnored private let accessToken: AccessToken
    @ObservationIgnored private let appleCode: AppleCode
    @ObservationIgnored private let signOut: SignOut

    init(
        account: Account, api: any AccountAPI, accessToken: @escaping AccessToken, appleCode: @escaping AppleCode,
        signOut: @escaping SignOut
    ) {
        self.account = account
        usesApple = account.provider == .apple
        self.api = api
        self.accessToken = accessToken
        self.appleCode = appleCode
        self.signOut = signOut
    }

    var confirmationName: String { AccountDeletionConfirmation.name(for: account) }
    var asksForWord: Bool { AccountDeletionConfirmation.asksForWord(account) }
    var confirmed: Bool { AccountDeletionConfirmation.confirms(account, typed: typed) }

    /// The account as the address book holds it now. Unreachable, the one this phone signed in with stands in.
    func load() async {
        guard let token = try? await accessToken(), let result = try? await api.account(accessToken: token) else {
            return
        }
        account = result.account
        usesApple = result.identities.contains { $0.provider == .apple }
    }

    func delete() async {
        guard confirmed, !busy, !deleted else { return }
        busy = true
        problem = nil
        defer { busy = false }
        do {
            guard let token = try await accessToken() else {
                problem = "Sign in again to delete your account."
                return
            }
            var code: String?
            if usesApple {
                do {
                    code = try await appleCode()
                } catch LoginError.cancelled {
                    return
                }
            }
            try await api.deleteAccount(
                accessToken: token, payload: AccountDeletePayload(confirmation: typed, appleAuthorizationCode: code))
            deleted = true
            await signOut()
        } catch let error as AddressBookRequestError {
            problem = Self.explain(error, name: confirmationName)
        } catch is CancellationError {
            return
        } catch {
            problem = error.localizedDescription
        }
    }

    static func explain(_ error: AddressBookRequestError, name: String) -> String {
        switch error.code {
        case "confirmation-mismatch": "That is not the name of this account. Type \(name) to delete it."
        case "apple-revocation-failed":
            "Apple did not end Sign in with Apple for Ruimte, so your account is still here. Try again."
        case "unauthorized": "Sign in again to delete your account."
        case "rate-limited": "Too many tries. Wait a minute, then try again."
        default: error.message
        }
    }
}

struct DeleteAccountPage: View {
    @State private var model: AccountDeletionModel
    @FocusState private var focused: Bool

    init(model: AccountDeletionModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        MobileForm {
            Section {
                Text("This cannot be undone. Deleting your Ruimte account removes:")
                ForEach(Self.whatGoes, id: \.self) { entry in
                    Label {
                        Text(entry)
                    } icon: {
                        Image(lucide: "dot", size: 16)
                    }
                    .foregroundStyle(MobileStyle.text)
                }
            } footer: {
                if model.usesApple {
                    Text("Apple asks you to confirm once more, so Ruimte can end Sign in with Apple for this account.")
                }
            }
            Section {
                TextField(model.confirmationName, text: $model.typed)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit { Task { await model.delete() } }
                    .disabled(model.busy)
                    .accessibilityIdentifier("settings.deleteAccount.name")
            } header: {
                Text(
                    model.asksForWord
                        ? "This account has no name. Type \(model.confirmationName) to confirm"
                        : "Type \(model.confirmationName) to confirm")
            } footer: {
                if let problem = model.problem {
                    Text(problem).foregroundStyle(MobileStyle.statusError)
                }
            }
            Section {
                Button(role: .destructive) {
                    focused = false
                    Task { await model.delete() }
                } label: {
                    HStack {
                        Label(model.busy ? "Deleting" : "Delete account", lucideIcon: "trash")
                        Spacer()
                        if model.busy { ProgressView() }
                    }
                }
                .disabled(!model.confirmed || model.busy)
                .accessibilityIdentifier("settings.deleteAccount.confirm")
            }
        }
        .navigationTitle("Delete account")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(model.busy)
        .interactiveDismissDisabled(model.busy)
        .task { await model.load() }
    }

    private static let whatGoes = [
        "The account and the ways to sign in to it.",
        "Every sign-in to it, on every device.",
        "Notifications to your phones and tablets.",
        "Your machines from the account. Each keeps its projects; take one off the account on that machine "
            + "before it joins another.",
    ]
}
