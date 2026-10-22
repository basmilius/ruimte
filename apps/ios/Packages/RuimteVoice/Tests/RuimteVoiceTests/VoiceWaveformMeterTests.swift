import Foundation
import Testing

@testable import RuimteVoice

@Suite struct VoiceWaveformMeterTests {
    private struct Case: Decodable {
        let name: String
        let windows: [[Float]]
        let raw: [[Double]]
        let eased: [[Double]]
    }

    /// `Fixtures/time-domain-waveform.json` is generated float samples, made bytes as Chromium's analyser makes them,
    /// through `timeDomainBands` and `easeBands` of `apps/client/src/audio/waveform.ts`, written out by Bun.
    @Test func theBandsAreTheDesktopsToTheLastDigits() throws {
        let url = try #require(
            Bundle.module.url(forResource: "time-domain-waveform", withExtension: "json", subdirectory: "Fixtures"))
        let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: url))
        #expect(cases.count == 4)
        for fixture in cases {
            var meter = VoiceWaveformMeter()
            for (step, window) in fixture.windows.enumerated() {
                #expect(window.count == VoiceSampleWindow.size)
                let raw = VoiceWaveformMeter.bands(of: window)
                meter.measure(window)
                for index in 0..<VoiceWaveformBands.count {
                    #expect(abs(raw[index] - fixture.raw[step][index]) < 1e-12, "\(fixture.name) \(step) raw \(index)")
                    #expect(
                        abs(meter.bands[index] - fixture.eased[step][index]) < 1e-12,
                        "\(fixture.name) \(step) eased \(index)")
                }
            }
        }
    }

    @Test func aSampleBecomesTheByteChromiumMakesOfIt() {
        #expect(VoiceWaveformMeter.byte(0) == 128)
        #expect(VoiceWaveformMeter.byte(-1e-9) == 128, "Float arithmetic rounds a hair below silence up to it")
        #expect(VoiceWaveformMeter.byte(-0.001) == 127)
        #expect(VoiceWaveformMeter.byte(1) == 255)
        #expect(VoiceWaveformMeter.byte(-2) == 0)
    }

    @Test func aSideWithoutNewAudioFallsBackSlowly() {
        var meter = VoiceWaveformMeter()
        meter.measure([Float](repeating: 0.5, count: VoiceSampleWindow.size))
        let loud = meter.bands
        #expect(loud.allSatisfy { abs($0 - 0.38) < 1e-12 }, "A column rises 38% of the way")
        meter.measure(nil)
        #expect(zip(meter.bands, loud).allSatisfy { abs($0 - $1 * 0.84) < 1e-12 }, "and falls 16%")
        meter.clear()
        #expect(meter == VoiceWaveformMeter())
    }

    @Test func theWindowKeepsTheNewestSamplesOldestFirstAndHandsThemOutOnce() {
        let window = VoiceSampleWindow()
        #expect(window.take() == nil)
        window.write(frames: 300) { Float($0) }
        let taken = window.take()
        #expect(taken == (44..<300).map(Float.init))
        #expect(window.take() == nil, "Nothing new came")
        window.write(frames: 6) { Float(1_000 + $0) }
        #expect(window.take() == Array((50..<300).map(Float.init) + (1_000..<1_006).map(Float.init)))
        window.write(frames: 0) { _ in 1 }
        #expect(window.take() == nil)
        window.write(frames: 1) { _ in 1 }
        window.clear()
        #expect(window.take() == nil)
    }
}
