// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "RuimteFoundationModels",
    platforms: [.macOS("26.4")],
    products: [.executable(name: "ruimte-foundation-models", targets: ["FoundationModelsHelper"])],
    targets: [
        .executableTarget(name: "FoundationModelsHelper"),
        .testTarget(name: "FoundationModelsHelperTests", dependencies: ["FoundationModelsHelper"])
    ]
)
