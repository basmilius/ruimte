import Foundation
import XCTest
import RuimtePulsar
@testable import RuimteTransport

final class WireFixtureTests: XCTestCase {
    private func fixtures() throws -> JSONValue {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "wire", withExtension: "json", subdirectory: "Fixtures"))
        return try JSONValue.decode(Data(contentsOf: url))
    }

    func testTypeScriptSignalBytesAndFingerprints() throws {
        let fixture = try fixtures()
        let binding = try field(fixture, "binding")
        XCTAssertEqual(try DirectIdentity.channelBinding(offer: string(binding, "offer"), answer: string(binding, "answer")), try string(binding, "expected"))
        for vector in fixture["signatures"]!.arrayValue! where vector["kind"]?.stringValue == "signal" {
            let args = vector["args"]!.arrayValue!
            XCTAssertEqual(try DirectIdentity.signalMessage(from: args[0].stringValue!, to: args[1].stringValue!, envelope: args[2]), try string(vector, "expected"))
        }
    }

    func testTypeScriptUTF16Pieces() throws {
        for vector in try fixtures()["framing"]!.arrayValue! {
            let input = try string(vector, "input")
            let expected = vector["pieces"]!.arrayValue!.compactMap(\.stringValue)
            let actual = DirectFraming.split(input)
            XCTAssertEqual(actual, expected)
            var assembler = FrameAssembler()
            for (index, piece) in actual.enumerated() {
                XCTAssertEqual(assembler.push(piece, maxChars: input.utf16.count), index == actual.count - 1 ? .frame(input) : .partial)
            }
        }
    }

    // Verifies rather than compares: CryptoKit's ed25519 signs the same message differently every time,
    // so interoperability is identical message bytes plus signatures each side accepts.
    func testTypeScriptEd25519Signatures() throws {
        for vector in try fixtures()["crypto"]!.arrayValue! {
            let message = try string(vector, "message")
            let key = try string(vector, "publicKey")
            let signature = try string(vector, "signature")
            XCTAssertTrue(DirectIdentity.verify(publicKey: key, message: message, signature: signature))
            XCTAssertFalse(DirectIdentity.verify(publicKey: key, message: message + "!", signature: signature))
        }
    }
}
