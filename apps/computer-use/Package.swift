// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "RuimteComputerUse",
    platforms: [.macOS("26.0")],
    targets: [
        .target(name: "ComputerUseCore"),
        .target(name: "Phantom", dependencies: ["ComputerUseCore"]),
        .executableTarget(name: "RuimteComputerUse", dependencies: ["ComputerUseCore", "Phantom"]),
        .executableTarget(name: "cu", dependencies: ["ComputerUseCore", "Phantom"]),
        .testTarget(name: "ComputerUseCoreTests", dependencies: ["ComputerUseCore"]),
        .testTarget(name: "PhantomTests", dependencies: ["Phantom", "ComputerUseCore"]),
    ]
)
