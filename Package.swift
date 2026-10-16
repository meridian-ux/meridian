// swift-tools-version: 6.2
// meridian.rendererIds: ["swiftui"]
import PackageDescription

let package = Package(
    name: "MeridianUI",
    platforms: [.macOS(.v13), .iOS(.v16)],
    products: [
        .library(name: "MeridianUI", targets: ["MeridianUI"]),
        .library(name: "MeridianProtos", targets: ["MeridianProtos"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-protobuf.git", exact: "1.39.0"),
    ],
    targets: [
        .target(name: "MeridianProtos", dependencies: [
            .product(name: "SwiftProtobuf", package: "swift-protobuf"),
        ], path: "packages/swiftui/Generated"),
        .target(name: "MeridianUI", dependencies: ["MeridianProtos"],
                path: "packages/swiftui/Sources/MeridianUI"),
        .testTarget(name: "MeridianUITests", dependencies: ["MeridianUI"],
                    path: "packages/swiftui/Tests/MeridianUITests"),
    ]
)
