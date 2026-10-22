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
        .package(url: "https://github.com/livekit/webrtc-xcframework.git", exact: "150.7871.03"),
    ],
    targets: [
        .target(
            name: "RuimteVoice",
            dependencies: ["RuimtePulsar", .product(name: "LiveKitWebRTC", package: "webrtc-xcframework", condition: .when(platforms: [.iOS]))],
            resources: [.process("Localizable.xcstrings")]),
        .testTarget(name: "RuimteVoiceTests", dependencies: ["RuimteVoice"], resources: [.copy("Fixtures")]),
    ]
)
