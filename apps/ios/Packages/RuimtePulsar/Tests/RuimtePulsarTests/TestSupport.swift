import Foundation
import Synchronization
import Testing

@testable import RuimtePulsar

/// `Fixtures/wire.json`, which `packages/contracts` writes from the TypeScript side.
func wireFixture() throws -> JSONValue {
    try JSONValue.decode(Data(contentsOf: #require(Bundle.module.url(forResource: "wire", withExtension: "json"))))
}

/// Fills what a test leaves out of an account status, so it decodes as a machine's answer does.
func accountsSnapshot(_ value: JSONValue) throws -> AccountsSnapshot {
    var object = try #require(value.objectValue)
    let defaults: [String: JSONValue] = [
        "email": .null, "plan": .null, "organization": .null, "home": .string("/home"), "message": .null,
        "checkedAt": .number(0),
    ]
    object["statuses"] = .array(
        (object["statuses"]?.arrayValue ?? []).map { status in
            .object(defaults.merging(status.objectValue ?? [:]) { _, given in given })
        })
    return try JSONValue.object(object).decoded(as: AccountsSnapshot.self)
}

final class MemorySessionStore: SessionStore {
    private let session = Mutex<StoredSession?>(nil)

    func read() -> StoredSession? { session.withLock { $0 } }
    func write(_ session: StoredSession?) { self.session.withLock { $0 = session } }
}

/// An HTTP answer to `request`, as a fake `fetch` hands it back.
func answer(_ request: URLRequest, status: Int = 200, body: Data = Data()) -> (Data, HTTPURLResponse) {
    (body, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
}

func answer(_ request: URLRequest, status: Int = 200, body: String) -> (Data, HTTPURLResponse) {
    answer(request, status: status, body: Data(body.utf8))
}

/// A new folder under the temporary directory; the caller removes it.
func temporaryFolder() throws -> URL {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    return folder
}
