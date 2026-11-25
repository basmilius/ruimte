# Speech bridge

Local streaming speech recognition for the optional Speech to Text feature, on Apple Speech (`SpeechAnalyzer`, macOS 26 and later). The Electron shell owns the helper. Audio stays in memory for the current dictation and never goes to disk or the network.

The helper picks `SpeechTranscriber` for a language it knows and falls back to `DictationTranscriber`, which knows more languages, Dutch among them. macOS downloads a language's model the first time a person dictates in it and keeps it, so Ruimte ships and stores no model. Only macOS builds carry the helper. Elsewhere, Settings reports Speech to Text as unavailable.

## Development

`bun dev` builds the release helper before it starts Electron, which takes Xcode. A standalone build is `swift build -c release` in this directory, and the tests are `swift test`.

## Helper protocol

`serve` reads newline-delimited JSON on stdin:

- `start` with `sessionId` and `language` (a BCP 47 locale)
- `samples` with `sessionId` and `audio` (base64 f32 little-endian, mono, 16 kHz)
- `stop` finalizes the audio and ends the utterance
- `cancel` discards the utterance

Stdout events carry `sessionId`: `ready`, `transcript` with the complete `text` and `final`, `ended`, or `failed` with `message`. Each transcript replaces the previous preview. `ready` waits until the language's model is installed, so a first dictation in a language can take a while. The client opens its microphone only after `ready`. An unexpected exit closes the microphone and drops the result.

The shell kills a helper that idles for sixty seconds, and kills it at once on cancel. A recording lasts at most ten minutes.

`transcribe --language nl-NL` reads raw samples from stdin and prints the final transcript, for checking a language by hand. It records no microphone:

```sh
say -o /tmp/test.aiff "Hello there" && ffmpeg -i /tmp/test.aiff -f f32le -ac 1 -ar 16000 /tmp/test.f32
.build/release/speech-bridge transcribe --language en-GB < /tmp/test.f32
```
