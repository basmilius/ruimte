import Foundation
import SpeechBridgeCore

private let outputLock = NSLock()

/// Writes one event as a line of JSON. Previews come from the results task, so writes take a lock.
func emit(_ event: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: event, options: [.withoutEscapingSlashes]) else {
        return
    }

    outputLock.withLock {
        FileHandle.standardOutput.write(data + Data("\n".utf8))
    }
}

func failed(_ sessionId: String, _ error: any Error) {
    emit(["type": "failed", "sessionId": sessionId, "message": String(describing: error)])
}

enum ServeError: Error, CustomStringConvertible {
    case busy
    case usage

    var description: String {
        switch self {
        case .busy:
            return "A dictation is already running"
        case .usage:
            return "Usage: speech-bridge serve | speech-bridge transcribe --language <locale> < samples.f32"
        }
    }
}

@main
struct SpeechBridge {
    static func main() async {
        let arguments = Array(CommandLine.arguments.dropFirst())

        do {
            if arguments == ["serve"] {
                try await serve()
            } else if arguments.count == 3, arguments[0] == "transcribe", arguments[1] == "--language" {
                try await transcribe(language: arguments[2])
            } else {
                throw ServeError.usage
            }
        } catch {
            FileHandle.standardError.write(Data("\(error)\n".utf8))
            exit(1)
        }
    }

    /// Reads the shell's requests on stdin, one dictation at a time.
    static func serve() async throws {
        var active: (id: String, recognition: Recognition)?

        for try await line in FileHandle.standardInput.bytes.lines {
            switch try parseRequest(line) {
            case .start(let sessionId, let language):
                if active != nil {
                    throw ServeError.busy
                }

                do {
                    let recognition = try await Recognition.start(language: language) { text in
                        emit(["type": "transcript", "sessionId": sessionId, "text": text, "final": false])
                    }

                    active = (sessionId, recognition)
                    emit(["type": "ready", "sessionId": sessionId])
                } catch {
                    failed(sessionId, error)
                }
            case .samples(let sessionId, let audio):
                guard let current = active, current.id == sessionId else {
                    continue
                }

                do {
                    try current.recognition.feed(try samples(fromBase64: audio))
                } catch {
                    active = nil
                    await current.recognition.cancel()
                    failed(sessionId, error)
                }
            case .stop(let sessionId):
                guard let current = active, current.id == sessionId else {
                    continue
                }

                active = nil

                do {
                    let text = try await current.recognition.finish()

                    emit(["type": "transcript", "sessionId": sessionId, "text": text, "final": true])
                    emit(["type": "ended", "sessionId": sessionId])
                } catch {
                    failed(sessionId, error)
                }
            case .cancel(let sessionId):
                guard let current = active, current.id == sessionId else {
                    continue
                }

                active = nil
                await current.recognition.cancel()
                emit(["type": "ended", "sessionId": sessionId])
            }
        }
    }

    /// Transcribes raw samples from stdin, for checking a language by hand. Records no microphone.
    static func transcribe(language: String) async throws {
        let audio = try samples(from: FileHandle.standardInput.readToEnd() ?? Data())
        let recognition = try await Recognition.start(language: language) { _ in }

        for start in stride(from: 0, to: audio.count, by: sampleRate) {
            try recognition.feed(Array(audio[start..<min(start + sampleRate, audio.count)]))
        }

        emit(["type": "transcript", "sessionId": "cli", "text": try await recognition.finish(), "final": true])
    }
}
