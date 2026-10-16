import XCTest
@testable import MeridianUI

final class SchemaTests: XCTestCase {
    static var root: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
    }

    static func fixtures() throws -> [(String, Meridian_Ui_V1_PanelDescriptor)] {
        let directory = root.appendingPathComponent("schemas/conformance/binpb")
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "binpb" }.sorted { $0.path < $1.path }
            .map { ($0.lastPathComponent, try Meridian_Ui_V1_PanelDescriptor(serializedBytes: Data(contentsOf: $0))) }
    }

    func testCanonicalPanelWireRoundTrip() throws {
        var panel = Meridian_Ui_V1_PanelDescriptor()
        panel.panelID = "native"
        panel.title = "Native panel"
        XCTAssertEqual(try Meridian_Ui_V1_PanelDescriptor(serializedBytes: panel.serializedData()), panel)
    }

    func testEveryCanonicalPanelFixtureDecodesAndRoundTrips() throws {
        let fixtures = try Self.fixtures()
        XCTAssertEqual(fixtures.count, 24)
        for (name, panel) in fixtures {
            XCTAssertEqual(try Meridian_Ui_V1_PanelDescriptor(serializedBytes: panel.serializedData()), panel, name)
        }
    }

    func testUnknownArmIsPreservedWithoutSelectingAnExistingArm() throws {
        let bytes = Data([0xd2, 0x0f, 0x00]) // Future field 250, length-delimited.
        let panel = try Meridian_Ui_V1_PanelDescriptor(serializedBytes: bytes)
        XCTAssertNil(panel.body)
        XCTAssertEqual(try panel.serializedData(), bytes)
    }
}
