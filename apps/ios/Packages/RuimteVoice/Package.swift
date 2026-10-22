// swift-tools-version: 6.4
import PackageDescription

// Voice's media: a WebRTC peer of its own to OpenAI that carries the microphone, the reply and the captions, and the
// one audio session of the app. It stays apart from RuimteTransport, whose link to a machine exchanges no audio.
let package = Package(
    name: "RuimteVoice",
    defaultLocalization: "en",
    platforms: [.iOS("27.0"), .macOS(.v15)],
    products: [.library(name: "RuimteVoice", targets: ["RuimteVoice"])],
    dependencies: [
        .package(path: "../RuimtePulsar"),
        .package(url: "https://github.com/stasel/WebRTC.git", exact: "153.0.0"),
    ],
    targets: [
        .target(
            name: "RuimteVoice",
            dependencies: ["RuimtePulsar", .product(name: "WebRTC", package: "WebRTC", condition: .when(platforms: [.iOS]))],
            resources: [.process("Localizable.xcstrings")]),
        .testTarget(name: "RuimteVoiceTests", dependencies: ["RuimteVoice"], resources: [.copy("Fixtures")]),
    ]
)
