// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "RuimteTransport",
    defaultLocalization: "en",
    platforms: [.iOS("27.0"), .macOS(.v15)],
    products: [
        .library(name: "RuimteTransport", targets: ["RuimteTransport"]),
        .executable(name: "chat-history-benchmark", targets: ["ChatHistoryBenchmark"]),
    ],
    dependencies: [
        .package(path: "../RuimtePulsar"),
        .package(url: "https://github.com/stasel/WebRTC.git", exact: "153.0.0")
    ],
    targets: [
        .target(
            name: "RuimteTransport",
            dependencies: ["RuimtePulsar", .product(name: "WebRTC", package: "WebRTC", condition: .when(platforms: [.iOS]))],
            resources: [.process("Localizable.xcstrings")]),
        .testTarget(name: "RuimteTransportTests", dependencies: ["RuimteTransport"], resources: [.copy("Fixtures")]),
        .executableTarget(name: "ChatHistoryBenchmark", dependencies: ["RuimtePulsar"], path: "Benchmarks/ChatHistory"),
    ]
)
