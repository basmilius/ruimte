// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "RuimtePulsar",
    platforms: [.iOS("26.0"), .macOS(.v15)],
    products: [.library(name: "RuimtePulsar", targets: ["RuimtePulsar"])],
    targets: [
        .target(name: "RuimtePulsar", resources: [.process("Generated/schemas.json")]),
        .testTarget(name: "RuimtePulsarTests", dependencies: ["RuimtePulsar"], resources: [.process("Fixtures")])
    ]
)
