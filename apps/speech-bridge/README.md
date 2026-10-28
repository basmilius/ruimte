# Speech bridge

Local streaming speech recognition for the optional Speech to Text feature. The Electron shell owns the helper and the model files. Audio stays in memory for the current dictation and never goes to disk or the network.

A release builds the helper for macOS only. The ONNX Runtime that `ort` links needs a newer glibc and libstdc++ than the Ubuntu 22.04 floor of the Linux build. Without the helper, Settings reports Speech to Text as unavailable.

## Development

`bun dev` builds the release helper before it starts Electron, so Rust and a native toolchain are required. A standalone build is `cargo build --release --locked` in this directory.

Turning on **Speech to Text** in **Settings > Voice** downloads about 2.6 GB of Nemotron 3.5 ASR streaming ONNX weights. `apps/desktop/src/speech-model.ts` pins the revision, sizes and SHA-256 hashes. A file is installed only after it verifies, and a cancelled download keeps the verified files. Turning the feature off stops the helper and keeps the model. **Remove model** deletes the weights and the compiled CoreML cache.

The helper runs ONNX Runtime on the CPU, since CoreML compilation of this model crashes Apple's compiler.

## Helper protocol

`serve --model <directory> --cache <directory>` loads the model once and reads newline-delimited JSON on stdin:

- `start` with `sessionId` and `language` (a supported BCP 47 locale or `auto`)
- `samples` with `sessionId` and `audio` (base64 f32 little-endian, mono, 16 kHz)
- `stop` flushes the final audio and ends the utterance
- `cancel` discards the utterance

Stdout events carry `sessionId`: `ready`, `transcript` with the complete `text` and `final`, `ended`, or `failed` with `message`. Each transcript replaces the previous preview. The client opens its microphone only after `ready`. An unexpected exit closes the microphone and drops the result.

The shell kills a helper that idles for sixty seconds, and kills it at once on cancel, also during a cold load. A recording lasts at most ten minutes.

`probe --model <directory> --cache <directory>` checks that a model loads. `transcribe --model <directory> --language nl-NL --cache <directory>` reads raw samples from stdin for test fixtures. Neither records a microphone.

## Verification

`cargo test --locked` covers sample and protocol validation. The weights carry their own NVIDIA license and do not ship with the app.
