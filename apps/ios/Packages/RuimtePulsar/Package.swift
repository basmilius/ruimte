// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "RuimtePulsar",
    defaultLocalization: "en",
    platforms: [.iOS("27.0"), .macOS(.v15)],
    products: [.library(name: "RuimtePulsar", targets: ["RuimtePulsar"])],
    targets: [
        .target(name: "RuimtePulsar", resources: [.process("Generated/schemas.json"), .process("Localizable.xcstrings")]),
        .testTarget(name: "RuimtePulsarTests", dependencies: ["RuimtePulsar"], resources: [.process("Fixtures")])
    ]
)
