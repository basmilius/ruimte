// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "RuimteComputerUse",
    platforms: [.macOS("26.0")],
    targets: [
        .target(name: "ComputerUseCore"),
        .executableTarget(name: "RuimteComputerUse", dependencies: ["ComputerUseCore"]),
        .executableTarget(name: "cu", dependencies: ["ComputerUseCore"]),
        .testTarget(name: "ComputerUseCoreTests", dependencies: ["ComputerUseCore"]),
    ]
)
