import Foundation

/// What a person types to delete an account, as `accountConfirmationName` and `confirmsAccountDeletion` in
/// `packages/pulsar/src/address-book.ts` decide it; the address book compares again with the same rule.
public enum AccountDeletionConfirmation {
    public static func name(for account: Account) -> String {
        account.displayName.present ?? account.login ?? WireConstants.accountDeleteWord
    }

    /// Whether the account has neither a name nor a login, so the fixed word stands in.
    public static func asksForWord(_ account: Account) -> Bool {
        account.displayName.present == nil && account.login == nil
    }

    public static func confirms(_ account: Account, typed: String) -> Bool {
        let expected = fold(name(for: account))
        return !expected.isEmpty && fold(typed) == expected
    }

    private static func fold(_ text: String) -> String {
        text.precomposedStringWithCanonicalMapping
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
            .lowercased()
    }
}

extension Presence {
    /// The value when one was sent; `null` and a missing field read the same.
    public var present: Value? {
        if case .value(let value) = self { return value }
        return nil
    }
}
