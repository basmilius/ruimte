import Foundation
import Testing

@testable import SpeechBridgeCore

@Test func readsEveryRequest() throws {
    #expect(try parseRequest(#"{"type":"start","sessionId":"a","language":"nl-NL"}"#) == .start(sessionId: "a", language: "nl-NL"))
    #expect(try parseRequest(#"{"type":"samples","sessionId":"a","audio":"AAAAPw=="}"#) == .samples(sessionId: "a", audio: "AAAAPw=="))
    #expect(try parseRequest(#"{"type":"stop","sessionId":"a"}"#) == .stop(sessionId: "a"))
    #expect(try parseRequest(#"{"type":"cancel","sessionId":"a"}"#) == .cancel(sessionId: "a"))
}

@Test func refusesARequestWithoutItsFields() {
    #expect(throws: RequestError.invalid) { try parseRequest(#"{"type":"stop"}"#) }
    #expect(throws: RequestError.invalid) { try parseRequest(#"{"type":"start","sessionId":"a"}"#) }
    #expect(throws: RequestError.invalid) { try parseRequest(#"{"type":"listen","sessionId":"a"}"#) }
    #expect(throws: RequestError.invalid) { try parseRequest("not json") }
}

@Test func refusesALineLongerThanTheShellSends() {
    let audio = String(repeating: "A", count: maxLineBytes)

    #expect(throws: RequestError.tooLarge) { try parseRequest(#"{"type":"samples","sessionId":"a","audio":"\#(audio)"}"#) }
}

@Test func decodesLittleEndianFloats() throws {
    #expect(try samples(fromBase64: Data([0, 0, 0, 0x3F]).base64EncodedString()) == [0.5])
    #expect(throws: SamplesError.partialSample) { try samples(from: Data([0, 1, 2])) }
    #expect(throws: SamplesError.notFinite) { try samples(from: Data([0, 0, 0xC0, 0x7F])) }
    #expect(throws: SamplesError.notBase64) { try samples(fromBase64: "%%") }
}

@Test func settlesFinalResultsAndReplacesThePreview() {
    var transcript = Transcript()

    transcript.take("Hallo", final: false)
    transcript.take("Hallo daar", final: false)
    #expect(transcript.text == "Hallo daar")

    transcript.take("Hallo daar.", final: true)
    transcript.take(" Hoe", final: false)
    #expect(transcript.text == "Hallo daar. Hoe")

    transcript.take(" Hoe gaat het?", final: true)
    #expect(transcript.text == "Hallo daar. Hoe gaat het?")
}
