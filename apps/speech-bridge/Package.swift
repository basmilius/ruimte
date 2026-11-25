// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SpeechBridge",
    platforms: [.macOS("26.0")],
    targets: [
        .target(name: "SpeechBridgeCore"),
        .executableTarget(name: "speech-bridge", dependencies: ["SpeechBridgeCore"]),
        .testTarget(name: "SpeechBridgeCoreTests", dependencies: ["SpeechBridgeCore"]),
    ]
)
