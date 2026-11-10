import Foundation
import RuimtePulsar
import XCTest

@testable import RuimteTransport

final class WireFixtureTests: XCTestCase {
    private func fixtures() throws -> JSONValue {
        // The one copy, which the Pulsar package's tests also read.
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("RuimtePulsar/Tests/RuimtePulsarTests/Fixtures/wire.json")
        return try JSONValue.decode(Data(contentsOf: url))
    }

    func testTypeScriptSignalBytesAndFingerprints() throws {
        let fixture = try fixtures()
        let binding = try field(fixture, "binding")
        XCTAssertEqual(
            try DirectIdentity.channelBinding(offer: string(binding, "offer"), answer: string(binding, "answer")),
            try string(binding, "expected"))
        for vector in fixture["signatures"]!.arrayValue! where vector["kind"]?.stringValue == "signal" {
            let args = vector["args"]!.arrayValue!
            XCTAssertEqual(
                try DirectIdentity.signalMessage(
                    from: args[0].stringValue!, to: args[1].stringValue!, envelope: args[2]),
                try string(vector, "expected"))
        }
    }

    /// What the machines and the address book build but this app never signs. A kind in neither list fails the test, so
    /// a signature the TypeScript side gains reaches a decision here rather than a skip.
    private static let builtOnlyByMachines: Set<String> = [
        "machineRegistration", "accessStatement", "accessStatementV2", "deviceLinkStart", "mapsTicketMac",
        "peerAccessRequest", "peerStatement", "extensionStore", "daemonChallenge", "clientAuth", "localChannel",
        "machineProof",
    ]

    func testEverySignatureKindIsBuiltTheSameOrBelongsToTheMachines() throws {
        let fixture = try fixtures()
        let purposes = try XCTUnwrap(fixture["purposes"]?.objectValue)
        XCTAssertEqual(
            purposes.mapValues { $0.stringValue }, SigningPurposes.all.mapValues { Optional($0) },
            "The app's purposes are the machines' table.")
        var seen: Set<String> = []
        for vector in try XCTUnwrap(fixture["signatures"]?.arrayValue) {
            let kind = try string(vector, "kind")
            let args = try XCTUnwrap(vector["args"]?.arrayValue)
            let expected = try string(vector, "expected")
            seen.insert(kind)
            let purpose = try XCTUnwrap(purposes[kind]?.stringValue, "\(kind) has no purpose")
            XCTAssertTrue(expected.hasPrefix(purpose + "\n"), "\(kind) starts with its purpose")
            let text = { (index: Int) in try XCTUnwrap(args[index].stringValue) }
            let built: String
            switch kind {
            case "sessionKey": built = try SigningBytes.sessionKey(code: text(0), publicKey: text(1))
            case "sessionRefresh":
                built = try SigningBytes.sessionRefresh(token: text(0), issuedAt: Int64(XCTUnwrap(args[1].numberValue)))
            case "accessRequest":
                built = try SigningBytes.accessRequest(machineID: text(0), publicKey: text(1), nonce: text(2))
            case "brokerHello":
                built = try BrokerPeer.helloMessage(
                    broker: text(0), role: text(1), publicKey: text(2), nonce: args[3])
            case "signal": built = try DirectIdentity.signalMessage(from: text(0), to: text(1), envelope: args[2])
            case "lanDoor": built = try DirectIdentity.lanDoorMessage(nonce: text(0), machineID: text(1), publicKey: text(2))
            case "daemonChannel":
                built = try DirectIdentity.daemonChannelMessage(machineID: text(0), challenge: text(1), binding: text(2))
            case "clientChannel":
                built = try DirectIdentity.clientChannelMessage(
                    machineID: text(0), challenge: text(1), publicKey: text(2), binding: text(3))
            default:
                XCTAssertTrue(
                    Self.builtOnlyByMachines.contains(kind),
                    "\(kind) is a new signature kind: build it here or list it as the machines' own")
                continue
            }
            XCTAssertEqual(built, expected, kind)
        }
        XCTAssertEqual(
            seen.subtracting(Self.builtOnlyByMachines).count, 8, "The app builds eight kinds; the fixture holds them all.")
    }

    func testTypeScriptUTF16Pieces() throws {
        for vector in try fixtures()["framing"]!.arrayValue! {
            let input = try string(vector, "input")
            let expected = vector["pieces"]!.arrayValue!.compactMap(\.stringValue)
            let actual = DirectFraming.split(input)
            XCTAssertEqual(actual, expected)
            var assembler = FrameAssembler()
            for (index, piece) in actual.enumerated() {
                XCTAssertEqual(
                    assembler.push(piece, maxChars: input.utf16.count),
                    index == actual.count - 1 ? .frame(input) : .partial)
            }
        }
    }
}
