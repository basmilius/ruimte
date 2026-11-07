import Foundation
import Testing

@testable import RuimteTransport

@MainActor struct DirectFrameInboxTests {
    private let handshake = DirectReceivePolicy(authenticated: false, deflating: false)
    private let accepted = DirectReceivePolicy(authenticated: true, deflating: true)
    private let compressed = Data(
        base64Encoded: "q1YqqSxIVbJSSi1LzStR0oHSVkrJGYklesUliSWlxUo6SgWJlTn5iSlKVtVKJakVIPmMwytzcvIVBgWlVFsLAA=="
    )!

    @Test func textAndBinaryPiecesKeepIndependentAssemblyAndUTF16Lengths() async {
        let decoder = DirectFrameDecoder()
        #expect(await decoder.push(Data("+hi 🌍".utf8), isBinary: false, policy: accepted) == .partial)
        #expect(await decoder.push(Data([0x01, 10, 20]), isBinary: true, policy: accepted) == .partial)
        #expect(
            await decoder.push(Data("= there".utf8), isBinary: true, policy: accepted)
                == .text("hi 🌍 there", units: 11, deflated: false))
        #expect(await decoder.push(Data([0x02, 30]), isBinary: true, policy: accepted) == .binary(Data([10, 20, 30])))
    }

    @Test func deflatedPiecesInflateSeparatelyFromTextAndBinary() async {
        let decoder = DirectFrameDecoder()
        #expect(await decoder.push(Data("+plain".utf8), isBinary: false, policy: accepted) == .partial)
        #expect(await decoder.push(Data([0x01, 7]), isBinary: true, policy: accepted) == .partial)
        let first = Data([0x03]) + compressed.prefix(10)
        let last = Data([0x04]) + compressed.dropFirst(10)
        #expect(await decoder.push(first, isBinary: true, policy: accepted) == .partial)
        let text =
            #"{"type":"event","event":"chat.status","payload":{"text":"\#(String(repeating: "héllo ", count: 20))"}}"#
        #expect(
            await decoder.push(last, isBinary: true, policy: accepted)
                == .text(text, units: text.utf16.count, deflated: true))
        #expect(
            await decoder.push(Data("= text".utf8), isBinary: false, policy: accepted)
                == .text("plain text", units: 10, deflated: false))
        #expect(await decoder.push(Data([0x02, 8]), isBinary: true, policy: accepted) == .binary(Data([7, 8])))
    }

    @Test func binaryAndCompressionRequireTheirHandshakePermissions() async {
        let decoder = DirectFrameDecoder()
        #expect(await decoder.push(Data([0x02, 1]), isBinary: true, policy: handshake) == .failure(.unexpectedBinary))
        #expect(
            await decoder.push(Data([0x04]) + compressed, isBinary: true, policy: handshake) == .failure(.unreadable))
        let noCompression = DirectReceivePolicy(authenticated: true, deflating: false)
        #expect(
            await decoder.push(Data([0x04]) + compressed, isBinary: true, policy: noCompression)
                == .failure(.unreadable))
        #expect(await decoder.push(Data([0x02, 1]), isBinary: true, policy: accepted) == .binary(Data([1])))
    }

    @Test func malformedInputKeepsTheExistingFailuresAndClearsItsLane() async {
        let decoder = DirectFrameDecoder()
        #expect(await decoder.push(Data([0xFF]), isBinary: false, policy: accepted) == .failure(.unreadable))
        #expect(await decoder.push(Data("+old".utf8), isBinary: false, policy: accepted) == .partial)
        #expect(
            await decoder.push(Data("missing marker".utf8), isBinary: false, policy: accepted) == .failure(.unreadable))
        #expect(
            await decoder.push(Data("=new".utf8), isBinary: false, policy: accepted)
                == .text("new", units: 3, deflated: false))
        #expect(
            await decoder.push(Data([0x04, 0xFF, 0xFF, 0xFF, 0xFF]), isBinary: true, policy: accepted)
                == .failure(.unreadable))
    }

    @Test func textLimitsFollowAuthenticationAndResetAfterRefusal() async {
        let decoder = DirectFrameDecoder()
        let large = String(repeating: "x", count: 4_097)
        #expect(await decoder.push(Data(("=" + large).utf8), isBinary: false, policy: handshake) == .failure(.tooLarge))
        #expect(
            await decoder.push(Data("=ok".utf8), isBinary: false, policy: handshake)
                == .text("ok", units: 2, deflated: false))
        #expect(
            await decoder.push(Data(("=" + large).utf8), isBinary: false, policy: accepted)
                == .text(large, units: 4_097, deflated: false))
    }

    @Test func resetDropsAllPartiallyAssembledLanes() async {
        let decoder = DirectFrameDecoder()
        #expect(await decoder.push(Data("+old".utf8), isBinary: false, policy: accepted) == .partial)
        #expect(await decoder.push(Data([0x01, 1]), isBinary: true, policy: accepted) == .partial)
        #expect(await decoder.push(Data([0x03, 99]), isBinary: true, policy: accepted) == .partial)
        await decoder.reset()
        #expect(
            await decoder.push(Data("=new".utf8), isBinary: false, policy: accepted)
                == .text("new", units: 3, deflated: false))
        #expect(await decoder.push(Data([0x02, 2]), isBinary: true, policy: accepted) == .binary(Data([2])))
        let text =
            #"{"type":"event","event":"chat.status","payload":{"text":"\#(String(repeating: "héllo ", count: 20))"}}"#
        #expect(
            await decoder.push(Data([0x04]) + compressed, isBinary: true, policy: accepted)
                == .text(text, units: text.utf16.count, deflated: true))
    }

    @Test func aClosedDecoderCannotAccumulateOrDeliverMorePieces() async {
        let decoder = DirectFrameDecoder()
        #expect(await decoder.push(Data("+old".utf8), isBinary: false, policy: accepted) == .partial)
        await decoder.close()
        await decoder.reset()
        #expect(await decoder.push(Data("=new".utf8), isBinary: false, policy: accepted) == .partial)
        #expect(await decoder.push(Data([0x02, 1]), isBinary: true, policy: accepted) == .partial)
        #expect(await decoder.push(Data([0x04]) + compressed, isBinary: true, policy: accepted) == .partial)
    }

    @Test func queuedPacketsReadPolicyAfterThePreviousMainActorDelivery() async {
        var policy = handshake
        var received: [DirectFrameResult] = []
        let inbox = DirectFrameInbox(
            policy: { policy },
            received: { result in
                received.append(result)
                if case .text("accepted", _, _) = result {
                    policy = DirectReceivePolicy(authenticated: true, deflating: true)
                }
            })
        let first = inbox.push(Data("=accepted".utf8), isBinary: false)
        let text = String(repeating: "x", count: 4_097)
        let second = inbox.push(Data(("=" + text).utf8), isBinary: false)
        let third = inbox.push(Data([0x02, 1]), isBinary: true)
        let last = inbox.push(Data([0x04]) + compressed, isBinary: true)
        await first.value
        await second.value
        await third.value
        await last.value
        #expect(received.count == 4)
        #expect(received[0] == .text("accepted", units: 8, deflated: false))
        #expect(received[1] == .text(text, units: 4_097, deflated: false))
        #expect(received[2] == .binary(Data([1])))
        if case .text(_, _, true) = received[3] {} else { Issue.record("The queued deflated reply was not delivered.") }
        inbox.close()
    }

    @Test func piecesThatWaitTogetherAfterTheHandshakeTakeOneTurn() async {
        var reads = 0
        var received: [DirectFrameResult] = []
        let inbox = DirectFrameInbox(
            policy: {
                reads += 1
                return accepted
            },
            received: { received.append($0) })
        let first = inbox.push(Data("=one".utf8), isBinary: false)
        let second = inbox.push(Data("=two".utf8), isBinary: false)
        let last = inbox.push(Data("=three".utf8), isBinary: false)
        await first.value
        await second.value
        await last.value
        #expect(reads == 1)
        #expect(
            received == [
                .text("one", units: 3, deflated: false), .text("two", units: 3, deflated: false),
                .text("three", units: 5, deflated: false),
            ])
        inbox.close()
    }

    @Test func partialPiecesStayInsideTheInboxUntilTheFrameIsComplete() async {
        var received: [DirectFrameResult] = []
        let inbox = DirectFrameInbox(policy: { accepted }, received: { received.append($0) })
        let first = inbox.push(Data("+first".utf8), isBinary: false)
        let middle = inbox.push(Data("+ middle".utf8), isBinary: false)
        let last = inbox.push(Data("= last".utf8), isBinary: false)
        await first.value
        await middle.value
        await last.value
        #expect(received == [.text("first middle last", units: 17, deflated: false)])
        inbox.close()
    }

    @Test func closingBeforeQueuedWorkStartsSuppressesEveryDelivery() async {
        var received: [DirectFrameResult] = []
        let inbox = DirectFrameInbox(policy: { accepted }, received: { received.append($0) })
        let first = inbox.push(Data("=first".utf8), isBinary: false)
        let last = inbox.push(Data("=last".utf8), isBinary: false)
        inbox.close()
        await first.value
        await last.value
        await inbox.push(Data("=after close".utf8), isBinary: false).value
        #expect(received.isEmpty)
    }

    @Test func closingFromDeliveryStopsPacketsAlreadyBehindIt() async {
        var received: [DirectFrameResult] = []
        var inbox: DirectFrameInbox!
        defer { inbox = nil }
        inbox = DirectFrameInbox(
            policy: { accepted },
            received: { result in
                received.append(result)
                inbox.close()
            })
        let first = inbox.push(Data("=first".utf8), isBinary: false)
        let last = inbox.push(Data("=last".utf8), isBinary: false)
        await first.value
        await last.value
        #expect(received == [.text("first", units: 5, deflated: false)])
    }
}
