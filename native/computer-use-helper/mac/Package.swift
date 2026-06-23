// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PiAgentComputerUseHelper",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "PiAgentComputerUseHelper", targets: ["PiAgentComputerUseHelper"])
    ],
    targets: [
        .executableTarget(name: "PiAgentComputerUseHelper")
    ]
)
