// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "RuimteIntelligentUI",
    platforms: [.iOS("27.0"), .macOS(.v15)],
    products: [.library(name: "RuimteIntelligentUI", targets: ["RuimteIntelligentUI"])],
    dependencies: [.package(path: "../RuimtePulsar")],
    targets: [
        .target(name: "RuimteIntelligentUI", dependencies: ["RuimtePulsar"], resources: [.process("Resources")]),
        .testTarget(name: "RuimteIntelligentUITests", dependencies: ["RuimteIntelligentUI"], resources: [.process("Fixtures")]),
    ]
)
