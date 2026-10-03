import Foundation
import Testing

@testable import RuimtePulsar

@Suite struct AccountDeletionTests {
    private func answer(_ request: URLRequest, status: Int, body: String = "") -> (Data, HTTPURLResponse) {
        (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }

    private func sentBody(_ request: URLRequest) -> [String: String] {
        guard let data = request.httpBody,
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: String]
        else { return [:] }
        return object
    }

    @Test func theNameComesFromTheDisplayNameThenTheLoginThenTheWord() {
        let named = Account(id: "a", provider: .github, login: "someone", displayName: .value("Bas Milius"))
        let login = Account(id: "a", provider: .github, login: "someone", displayName: .null)
        let nameless = Account(id: "a", provider: .apple, login: nil)
        #expect(AccountDeletionConfirmation.name(for: named) == "Bas Milius")
        #expect(AccountDeletionConfirmation.name(for: login) == "someone")
        #expect(AccountDeletionConfirmation.name(for: nameless) == "DELETE")
        #expect(!AccountDeletionConfirmation.asksForWord(login))
        #expect(AccountDeletionConfirmation.asksForWord(nameless))
    }

    @Test func caseAndRunsOfWhitespaceDoNotMatter() {
        let account = Account(id: "a", provider: .github, login: "someone", displayName: .value("Bas Milius"))
        #expect(AccountDeletionConfirmation.confirms(account, typed: "  bas   MILIUS "))
        #expect(!AccountDeletionConfirmation.confirms(account, typed: "Bas"))
        let nameless = Account(id: "a", provider: .apple, login: nil)
        #expect(AccountDeletionConfirmation.confirms(nameless, typed: "delete"))
        let empty = Account(id: "a", provider: .github, login: nil, displayName: .value(" "))
        #expect(!AccountDeletionConfirmation.confirms(empty, typed: " "))
    }

    @Test func deletingSendsTheConfirmationAndTheAppleCodeWithTheToken() async throws {
        let client = AddressBookClient(fetch: { request in
            #expect(request.httpMethod == "DELETE")
            #expect(request.url?.path == "/v1/account")
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer token-1")
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
            #expect(sentBody(request) == ["confirmation": "DELETE", "appleAuthorizationCode": "code-1"])
            return answer(request, status: 204)
        })
        try await client.deleteAccount(
            accessToken: "token-1", payload: AccountDeletePayload(confirmation: "DELETE", appleAuthorizationCode: "code-1"))
    }

    @Test func anAccountWithoutAppleSendsNoCode() async throws {
        let client = AddressBookClient(fetch: { request in
            #expect(sentBody(request) == ["confirmation": "someone"])
            return answer(request, status: 204)
        })
        try await client.deleteAccount(accessToken: "token-1", payload: AccountDeletePayload(confirmation: "someone"))
    }

    @Test(arguments: [("confirmation-mismatch", 400), ("apple-revocation-failed", 502)])
    func aRefusalComesBackWithItsCode(code: String, status: Int) async throws {
        let client = AddressBookClient(fetch: { request in
            answer(request, status: status, body: #"{"error":{"code":"\#(code)","message":"Refused"}}"#)
        })
        do {
            try await client.deleteAccount(accessToken: "token-1", payload: AccountDeletePayload(confirmation: "x"))
            Issue.record("Expected the deletion to be refused")
        } catch let error as AddressBookRequestError {
            #expect(error.code == code)
            #expect(error.status == status)
        }
    }

    @Test func theAccountIsReadWithItsIdentities() async throws {
        let client = AddressBookClient(fetch: { request in
            #expect(request.httpMethod == "GET")
            #expect(request.url?.path == "/v1/account")
            return answer(
                request, status: 200,
                body: #"""
                    {"account":{"id":"a","provider":"github","login":"someone"},
                     "identities":[{"provider":"github","login":"someone","createdAt":1},
                                   {"provider":"apple","login":null,"createdAt":2}]}
                    """#)
        })
        let result = try await client.account(accessToken: "token-1")
        #expect(result.account.login == "someone")
        #expect(result.identities.map(\.provider) == [.github, .apple])
    }
}
