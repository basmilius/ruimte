import AVFAudio
import Foundation
import Speech
import SpeechBridgeCore

enum RecognitionError: Error, CustomStringConvertible {
    case unsupportedLanguage(String)
    case noAudioFormat
    case conversion(String)
    case tooLong

    var description: String {
        switch self {
        case .unsupportedLanguage(let language):
            return "Speech recognition does not support \(language) on this Mac"
        case .noAudioFormat:
            return "Speech recognition offers no audio format for this language"
        case .conversion(let reason):
            return "Audio could not be converted: \(reason)"
        case .tooLong:
            return "A dictation can last at most ten minutes"
        }
    }
}

/// The transcriber a language gets. SpeechTranscriber is the newer model, so it goes first;
/// DictationTranscriber covers the languages only it knows, Dutch among them.
enum Transcriber {
    case speech(SpeechTranscriber)
    case dictation(DictationTranscriber)

    static func forLanguage(_ identifier: String) async throws -> Transcriber {
        let wanted = Locale(identifier: identifier)

        if SpeechTranscriber.isAvailable, let locale = await SpeechTranscriber.supportedLocale(equivalentTo: wanted) {
            return .speech(SpeechTranscriber(locale: locale, preset: .progressiveTranscription))
        }

        if let locale = await DictationTranscriber.supportedLocale(equivalentTo: wanted) {
            return .dictation(DictationTranscriber(locale: locale, preset: .progressiveLongDictation))
        }

        throw RecognitionError.unsupportedLanguage(identifier)
    }

    var module: any SpeechModule {
        switch self {
        case .speech(let transcriber):
            return transcriber
        case .dictation(let transcriber):
            return transcriber
        }
    }

    /// Follows the results until the analyzer finishes, and answers the whole transcript.
    func follow(preview: @escaping @Sendable (String) -> Void) -> Task<String, any Error> {
        switch self {
        case .speech(let transcriber):
            return Task { try await collect(transcriber.results, text: \.text, preview: preview) }
        case .dictation(let transcriber):
            return Task { try await collect(transcriber.results, text: \.text, preview: preview) }
        }
    }
}

private func collect<Results: AsyncSequence>(
    _ results: Results,
    text: (Results.Element) -> AttributedString,
    preview: (String) -> Void
) async throws -> String where Results.Element: SpeechModuleResult {
    var transcript = Transcript()
    var shown = ""

    for try await result in results {
        transcript.take(String(text(result).characters), final: result.isFinal)

        if transcript.text != shown {
            shown = transcript.text
            preview(shown)
        }
    }

    return transcript.text
}

/// Turns the shell's 16 kHz float samples into buffers in the format the analyzer asked for.
final class Converter {
    private let input: AVAudioFormat
    private let output: AVAudioFormat
    private let converter: AVAudioConverter?

    init(input: AVAudioFormat, output: AVAudioFormat) throws {
        self.input = input
        self.output = output

        if input == output {
            converter = nil
        } else if let converter = AVAudioConverter(from: input, to: output) {
            self.converter = converter
        } else {
            throw RecognitionError.conversion("no converter from \(input) to \(output)")
        }
    }

    func buffer(_ samples: [Float]) throws -> AVAudioPCMBuffer {
        guard let buffer = AVAudioPCMBuffer(pcmFormat: input, frameCapacity: AVAudioFrameCount(samples.count)),
            let channel = buffer.floatChannelData?[0]
        else {
            throw RecognitionError.conversion("no buffer for \(samples.count) samples")
        }

        buffer.frameLength = AVAudioFrameCount(samples.count)
        samples.withUnsafeBufferPointer { source in
            channel.update(from: source.baseAddress!, count: samples.count)
        }

        guard let converter else {
            return buffer
        }

        let ratio = output.sampleRate / input.sampleRate
        let capacity = AVAudioFrameCount((Double(samples.count) * ratio).rounded(.up)) + 1

        guard let converted = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: capacity) else {
            throw RecognitionError.conversion("no buffer for \(capacity) frames")
        }

        var handedOver = false
        var failure: NSError?
        let status = converter.convert(to: converted, error: &failure) { _, state in
            if handedOver {
                // More may follow in the next call, so the converter keeps its state rather than flushing.
                state.pointee = .noDataNow

                return nil
            }

            handedOver = true
            state.pointee = .haveData

            return buffer
        }

        if status == .error {
            throw RecognitionError.conversion(failure?.localizedDescription ?? "unknown error")
        }

        return converted
    }
}

/// One dictation, from its first samples to its final transcript.
final class Recognition {
    private let analyzer: SpeechAnalyzer
    private let input: AsyncStream<AnalyzerInput>.Continuation
    private let converter: Converter
    private let results: Task<String, any Error>
    private var heard = 0

    private init(analyzer: SpeechAnalyzer, input: AsyncStream<AnalyzerInput>.Continuation, converter: Converter, results: Task<String, any Error>) {
        self.analyzer = analyzer
        self.input = input
        self.converter = converter
        self.results = results
    }

    /// Installs the language's model first when this Mac lacks it, which macOS downloads once.
    static func start(language: String, preview: @escaping @Sendable (String) -> Void) async throws -> Recognition {
        let transcriber = try await Transcriber.forLanguage(language)
        let modules = [transcriber.module]

        if let installation = try await AssetInventory.assetInstallationRequest(supporting: modules) {
            try await installation.downloadAndInstall()
        }

        guard let shellFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(sampleRate), channels: 1, interleaved: false),
            let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: modules, considering: shellFormat)
        else {
            throw RecognitionError.noAudioFormat
        }

        let converter = try Converter(input: shellFormat, output: analyzerFormat)
        let analyzer = SpeechAnalyzer(modules: modules)

        try await analyzer.prepareToAnalyze(in: analyzerFormat)

        let (stream, input) = AsyncStream.makeStream(of: AnalyzerInput.self)
        let results = transcriber.follow(preview: preview)

        try await analyzer.start(inputSequence: stream)

        return Recognition(analyzer: analyzer, input: input, converter: converter, results: results)
    }

    func feed(_ samples: [Float]) throws {
        heard += samples.count

        guard heard <= maxSamples else {
            throw RecognitionError.tooLong
        }

        input.yield(AnalyzerInput(buffer: try converter.buffer(samples)))
    }

    func finish() async throws -> String {
        input.finish()
        try await analyzer.finalizeAndFinishThroughEndOfInput()

        return try await results.value
    }

    func cancel() async {
        input.finish()
        await analyzer.cancelAndFinishNow()
        results.cancel()
    }
}
