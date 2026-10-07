# Chat history decoding

Run from the repository root:

```sh
swift run -c release --package-path apps/ios/Packages/RuimteTransport chat-history-benchmark
```

Compares decoding a synthetic history of 2,871 messages with its last 60 messages, using Ruimte's `JSONValue` decoder. Each dataset gets two warmup runs and ten measured runs. The tab-separated output reports its size and median, minimum and maximum decoding time in milliseconds. Encoding happens before measurement.

Compare results on the same machine and build configuration. This benchmark runs only when requested and imposes no timing threshold on the test suite.
