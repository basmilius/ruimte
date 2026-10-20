import Foundation
import Testing

@testable import RuimteVoice

@Suite struct VoiceCaptionsTests {
    private static func delta(_ type: String, _ delta: String, start: Double = 0, end: Double = 0) -> String {
        #"{"type":"\#(type)","delta":"\#(delta)","start_ms":\#(start),"end_ms":\#(end)}"#
    }

    @Test func aTranscriptDeltaIsACaptionOfItsSpeaker() {
        #expect(
            LiveServiceEvent.parse(Self.delta("session.input_transcript.delta", "Open the", start: 10, end: 400))
                == .caption(LiveCaption(speaker: .person, delta: "Open the", startMs: 10, endMs: 400)))
        #expect(
            LiveServiceEvent.parse(Self.delta("session.output_transcript.delta", "Sure"))
                == .caption(LiveCaption(speaker: .model, delta: "Sure", startMs: 0, endMs: 0)))
    }

    @Test func aFunctionCallIsTheMachinesAndNeverReachesTheApp() {
        let call = #"{"type":"response.event","event":{"type":"response.function_call_arguments.done","call_id":"c1","name":"chat_read","arguments":"{}"}}"#
        #expect(LiveServiceEvent.parse(call) == .ignored)
        #expect(LiveServiceEvent.parse(#"{"type":"response.function_call_arguments.delta","delta":"{"}"#) == .ignored)
    }

    @Test func theStartAndAFailureOfTheSessionAreTheirOwnEvents() {
        #expect(LiveServiceEvent.parse(#"{"type":"session.started"}"#) == .started)
        #expect(LiveServiceEvent.parse(#"{"type":"session.error","error":{"message":"no"}}"#) == .failed)
    }

    @Test func whatIsNoEventOfTheServiceIsIgnored() {
        #expect(LiveServiceEvent.parse("not json") == .ignored)
        #expect(LiveServiceEvent.parse(#"{"delta":"no type"}"#) == .ignored)
        #expect(LiveServiceEvent.parse(Self.delta("session.output_transcript.delta", "")) == .ignored)
        #expect(LiveServiceEvent.parse(#"{"type":"session.output_transcript.delta","delta":7}"#) == .ignored)
    }

    @Test func deltasOfOneSpeakerMakeOneLine() {
        var transcript = VoiceTranscript()
        transcript.add(LiveCaption(speaker: .person, delta: " Open", startMs: 0, endMs: 200))
        transcript.add(LiveCaption(speaker: .person, delta: " the chat", startMs: 200, endMs: 600))
        transcript.add(LiveCaption(speaker: .model, delta: "Done.", startMs: 900, endMs: 1_200))
        #expect(transcript.lines.map(\.text) == ["Open the chat", "Done."])
        #expect(transcript.lines.map(\.speaker) == [.person, .model])
        #expect(transcript.lines[0].endMs == 600)
        #expect(transcript.current?.text == "Done.")
    }

    @Test func thePersonSpeakingRightBehindTheReplyInterruptedIt() {
        var transcript = VoiceTranscript()
        transcript.add(LiveCaption(speaker: .model, delta: "The chat says", startMs: 0, endMs: 1_000))
        transcript.add(LiveCaption(speaker: .person, delta: "Stop", startMs: 1_500, endMs: 1_800))
        #expect(transcript.lines[0].interrupted)

        var later = VoiceTranscript()
        later.add(LiveCaption(speaker: .model, delta: "Done.", startMs: 0, endMs: 1_000))
        later.add(LiveCaption(speaker: .person, delta: "Thanks", startMs: 1_751, endMs: 2_000))
        #expect(!later.lines[0].interrupted)
    }

    @Test func aLineOfOnlySpaceIsNoLine() {
        var transcript = VoiceTranscript()
        transcript.add(LiveCaption(speaker: .model, delta: "  ", startMs: 0, endMs: 10))
        #expect(transcript.lines.isEmpty)
    }

    @Test func onlyTheLastLinesAreKept() {
        var transcript = VoiceTranscript()
        for index in 0..<(VoiceTranscript.keptLines + 5) {
            let speaker: VoiceSpeaker = index.isMultiple(of: 2) ? .person : .model
            transcript.add(LiveCaption(speaker: speaker, delta: "line \(index)", startMs: 0, endMs: 0))
        }
        #expect(transcript.lines.count == VoiceTranscript.keptLines)
        #expect(transcript.lines.first?.text == "line 5")
        #expect(Set(transcript.lines.map(\.id)).count == VoiceTranscript.keptLines)
    }
}
