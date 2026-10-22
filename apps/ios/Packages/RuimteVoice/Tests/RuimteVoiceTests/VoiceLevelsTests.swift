import Foundation
import Testing

@testable import RuimteVoice

@Suite struct VoiceLevelsTests {
    @Test func theMicrophoneIsTheAudioSourceAndTheReplyTheInboundAudio() {
        let stats: [(type: String, values: [String: Any])] = [
            ("media-source", ["kind": "video", "audioLevel": NSNumber(value: 0.9)]),
            ("media-source", ["kind": "audio", "audioLevel": NSNumber(value: 0.25)]),
            ("outbound-rtp", ["kind": "audio", "audioLevel": NSNumber(value: 0.7)]),
            ("inbound-rtp", ["mediaType": "audio", "audioLevel": NSNumber(value: 0.04)]),
        ]
        #expect(VoiceLevels.read(stats) == VoiceLevels(person: 0.25, voice: 0.04))
    }

    @Test func aReportWithoutAudioReadsAsSilence() {
        #expect(VoiceLevels.read([("transport", ["bytesSent": NSNumber(value: 10)])]) == .silent)
        #expect(VoiceLevels.read([]) == .silent)
    }

    @Test func theHistoryKeepsTheLastLevelsOldestFirstAndLiftsQuietSpeech() {
        var history = VoiceLevelHistory()
        #expect(history.person.count == VoiceLevelHistory.kept)
        history.add(VoiceLevels(person: 0.04, voice: 1))
        history.add(VoiceLevels(person: 0, voice: 4))
        #expect(history.person.count == VoiceLevelHistory.kept)
        #expect(abs(history.person[VoiceLevelHistory.kept - 2] - 0.26) < 0.0001)
        #expect(history.person.last == 0)
        #expect(history.voice.suffix(2) == [1, 1], "A bar never grows past the band")
        for _ in 0..<VoiceLevelHistory.kept { history.add(.silent) }
        #expect(history == VoiceLevelHistory())
        history.add(VoiceLevels(person: 1, voice: 1))
        history.clear()
        #expect(history == VoiceLevelHistory())
    }
}
