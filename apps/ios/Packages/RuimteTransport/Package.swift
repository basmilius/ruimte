// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "RuimteTransport",
    platforms: [.iOS(.v26), .macOS(.v15)],
    products: [.library(name: "RuimteTransport", targets: ["RuimteTransport"])],
    dependencies: [
        .package(path: "../RuimtePulsar"),
        .package(url: "https://github.com/stasel/WebRTC.git", exact: "153.0.0")
    ],
    targets: [
        .target(name: "RuimteTransport", dependencies: ["RuimtePulsar", .product(name: "WebRTC", package: "WebRTC", condition: .when(platforms: [.iOS]))]),
        .testTarget(name: "RuimteTransportTests", dependencies: ["RuimteTransport"], resources: [.copy("Fixtures")])
    ],
    swiftLanguageModes: [.v5]
)
