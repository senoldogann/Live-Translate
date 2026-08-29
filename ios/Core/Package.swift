// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LiveTranslateCore",
    platforms: [
        .iOS(.v16),
        .macOS(.v13)
    ],
    products: [
        .library(name: "LiveTranslateCore", targets: ["LiveTranslateCore"])
    ],
    targets: [
        .target(name: "LiveTranslateCore"),
        .testTarget(
            name: "LiveTranslateCoreTests",
            dependencies: ["LiveTranslateCore"]
        )
    ]
)
