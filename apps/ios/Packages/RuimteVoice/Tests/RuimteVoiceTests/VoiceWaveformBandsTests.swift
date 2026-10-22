import Foundation
import Testing

@testable import RuimteVoice

@Suite struct VoiceWaveformBandsTests {
    private struct IdleCase: Decodable {
        let atMs: Double
        let count: Int
        let input: [Double]
        let output: [Double]
    }

    /// `Fixtures/idle-waveform.json` is `idleVoiceBands` of `apps/client/src/voice/idle-waveform.ts` at each pattern, in
    /// the blends between them and past the wrap, written out by Bun.
    @Test func theIdleBandIsTheDesktopsToTheLastDigits() throws {
        let url = try #require(
            Bundle.module.url(forResource: "idle-waveform", withExtension: "json", subdirectory: "Fixtures"))
        let cases = try JSONDecoder().decode([IdleCase].self, from: Data(contentsOf: url))
        #expect(cases.count == 15)
        for fixture in cases {
            let bands = VoiceWaveformBands.idle(atMs: fixture.atMs, count: fixture.count)
            #expect(bands.input.count == fixture.count)
            for index in 0..<fixture.count {
                #expect(abs(bands.input[index] - fixture.input[index]) < 1e-12, "input \(index) at \(fixture.atMs) ms")
                #expect(
                    abs(bands.output[index] - fixture.output[index]) < 1e-12, "output \(index) at \(fixture.atMs) ms")
            }
        }
    }

    @Test func theIdleBandStaysBetweenItsClamps() {
        for step in 0..<200 {
            let bands = VoiceWaveformBands.idle(atMs: Double(step) * 517)
            #expect((bands.input + bands.output).allSatisfy { $0 >= 0.04 && $0 <= 0.7 })
        }
    }

    @Test func aColumnEasesTowardItsTargetWithA110MillisecondTimeConstant() {
        #expect(VoiceWaveformBands.response(elapsedMs: 0) == 0)
        #expect(abs(VoiceWaveformBands.response(elapsedMs: 110) - (1 - exp(-1))) < 1e-12)
        let target = VoiceWaveformBands(
            input: Array(repeating: 1, count: VoiceWaveformBands.count),
            output: Array(repeating: 0.5, count: VoiceWaveformBands.count))
        let half = VoiceWaveformBands.silent.eased(toward: target, response: 0.5)
        #expect(half.input.allSatisfy { $0 == 0.5 })
        #expect(half.output.allSatisfy { $0 == 0.25 })
        let fresh = VoiceWaveformBands(input: [], output: []).eased(toward: target, response: 0.1)
        #expect(fresh == target, "A column with nothing drawn yet starts at its target")
    }

    @Test func theLabelsSpeakPastTheDesktopsThresholds() {
        #expect(!VoiceWaveformBands.inputSpeaks([0.06, 0.01]))
        #expect(VoiceWaveformBands.inputSpeaks([0.01, 0.061]))
        #expect(!VoiceWaveformBands.outputSpeaks([0.04]))
        #expect(VoiceWaveformBands.outputSpeaks([0.041]))
        #expect(!VoiceWaveformBands.inputSpeaks([]))
    }
}
