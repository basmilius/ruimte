import RuimtePulsar
import Testing

@testable import RuimteTransport

struct MachineErrorCodeTests {
    @Test func aRefusalReadsItsKnownCode() {
        let error = MachineClientError.server(code: "branch-not-merged", message: "Not merged")
        #expect(error.code == .branchNotMerged)
        #expect(error.machineCode == .branchNotMerged)
    }

    @Test func aCodeTheAppDoesNotKnowReadsAsNil() {
        #expect(MachineClientError.server(code: "from-the-future", message: "No").code == nil)
        #expect(MachineClientError.timeout("chat.list").code == nil)
        #expect(TransportFailure.invalid("not-paired").machineCode == nil)
    }

    @Test func aRefusedHandshakeCarriesTheCodeTheMachineSent() {
        let frame = JSONValue.object([
            "type": .string("direct.refused"), "reason": .string("No."), "code": .string("not-paired"),
        ])
        #expect(DirectIdentity.refusal(frame) == .refused(code: .notPaired, reason: "No."))
    }

    @Test func aMachineWithoutTheFieldIsKnownByItsWordsAlone() {
        let words = "This machine does not know this device. Sign in to the account it is on to be let in again."
        let old = JSONValue.object(["type": .string("direct.refused"), "reason": .string(words)])
        #expect(DirectIdentity.refusal(old) == .refused(code: .notPaired, reason: words))
    }

    @Test func theWordsNeverOverrideACodeTheMachineSent() {
        let frame = JSONValue.object([
            "type": .string("direct.refused"), "reason": .string("It does not know this device."),
            "code": .string("statements-refused"),
        ])
        #expect(DirectIdentity.refusal(frame) == .refused(code: .statementsRefused, reason: "It does not know this device."))
        let unknown = JSONValue.object([
            "type": .string("direct.refused"), "reason": .string("It does not know this device."),
            "code": .string("from-the-future"),
        ])
        #expect(DirectIdentity.refusal(unknown) == .refused(code: nil, reason: "It does not know this device."))
    }

    @Test func aRefusalWithNeitherCodeNorKnownWordsHasNoCode() {
        let frame = JSONValue.object(["type": .string("direct.refused"), "reason": .string("Busy.")])
        #expect(DirectIdentity.refusal(frame) == .refused(code: nil, reason: "Busy."))
    }
}
