// swift-tools-version: 6.4
import PackageDescription

let package = Package(
    name: "RuimteShared",
    defaultLocalization: "en",
    platforms: [.iOS("27.0"), .macOS(.v15)],
    products: [.library(name: "RuimteShared", targets: ["RuimteShared"])],
    dependencies: [.package(path: "../RuimtePulsar")],
    targets: [
        .target(name: "RuimteShared", dependencies: ["RuimtePulsar"], resources: [.process("Localizable.xcstrings")]),
        .testTarget(name: "RuimteSharedTests", dependencies: ["RuimteShared"], resources: [.process("Fixtures")]),
    ]
)
