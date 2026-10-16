import SwiftUI
import ViewInspector
import XCTest
@testable import MeridianUI

/// A projection of the actual initial SwiftUI view body, not descriptor text,
/// mounted OS accessibility, geometry, or an emulated renderer. Paths retain
/// hierarchy and source order within each explicit node category. Callback and
/// state-update behavior is tested separately in ContentFlowTests.
@MainActor
enum NativeViewDump {
    static func render<V: SwiftUI.View>(_ view: V) throws -> String {
        let root = try view.inspect()
        var lines = ["SwiftUI view projection v1 — not OS accessibility"]
        func quote(_ text: String) -> String { String(reflecting: text) }
        for text in root.findAll(ViewType.Text.self) {
            var line = "text \(text.pathToRoot) \(quote(try text.string()))"
            if let label = try? text.accessibilityLabel().string() {
                line += " declared-label=\(quote(label))"
            }
            if let help = try? text.help().string(), !help.isEmpty {
                line += " help=\(quote(help))"
            }
            if text.isHidden() { line += " hidden=true" }
            lines.append(line)
        }
        for label in root.findAll(ViewType.Label.self) {
            let title = try label.title().findAll(ViewType.Text.self).map { try $0.string() }.joined(separator: " | ")
            var line = "label \(label.pathToRoot) title=\(quote(title))"
            if let declared = try? label.accessibilityLabel().string() { line += " declared-label=\(quote(declared))" }
            lines.append(line)
        }
        for button in root.findAll(ViewType.Button.self) {
            let labels = try button.labelView().findAll(ViewType.Text.self).map { try $0.string() }
            guard labels.contains(where: { !$0.isEmpty }) else { throw DumpError.unlabeledControl }
            lines.append("button \(button.pathToRoot) label=\(quote(labels.joined(separator: " | "))) disabled=\(button.isDisabled())")
        }
        for picker in root.findAll(ViewType.Picker.self) {
            let labels = try picker.labelView().findAll(ViewType.Text.self).map { try $0.string() }
            guard labels.contains(where: { !$0.isEmpty }) else { throw DumpError.unlabeledControl }
            let selected = try picker.selectedValue(Data?.self)
            // IDs are used only to resolve visible selection; payloads and raw
            // identifier bytes do not become a second descriptor artifact.
            let options = try picker.findAll(ViewType.Text.self)
                .filter { !$0.pathToRoot.contains(".labelView()") }.map { text in
                guard let tag = try text.tag().base as? Data? else { throw DumpError.missingOptions }
                return "\(quote(try text.string())) selected=\(tag == selected)"
            }
            guard !options.isEmpty else { throw DumpError.missingOptions }
            lines.append("picker \(picker.pathToRoot) label=\(quote(labels.joined(separator: " | "))) disabled=\(picker.isDisabled())")
            lines.append(contentsOf: options.map { "  option \($0)" })
        }
        for image in root.findAll(ViewType.Image.self) {
            var line = "image \(image.pathToRoot) name=\(quote(try image.actualImage().name()))"
            if let label = try? image.accessibilityLabel().string() {
                line += " declared-label=\(quote(label))"
            }
            if let hidden = try? image.accessibilityHidden() { line += " declared-hidden=\(hidden)" }
            lines.append(line)
        }
        guard lines.count > 1 else { throw DumpError.emptyProjection }
        return lines.joined(separator: "\n") + "\n"
    }

    enum DumpError: Error { case unlabeledControl, missingOptions, emptyProjection }
}

@MainActor
final class ViewDumpTests: XCTestCase {
    func testEveryCanonicalInitialViewMatchesCommittedProjection() throws {
        let directory = SchemaTests.root.appendingPathComponent("schemas/conformance/swiftui")
        let fixtures = try SchemaTests.fixtures()
        let expected = Set(fixtures.map { $0.0.replacingOccurrences(of: ".binpb", with: ".txt") })
        let update = ProcessInfo.processInfo.environment["UPDATE_SNAPSHOTS"] == "1"
        if update { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true) }
        for (name, descriptor) in fixtures {
            var calls = 0
            let host = MeridianHost(admit: { _ in calls += 1; return .allow }, execute: { _ in calls += 1 })
            let dump = try NativeViewDump.render(MeridianPanel(descriptor, host: host))
            let path = directory.appendingPathComponent(name.replacingOccurrences(of: ".binpb", with: ".txt"))
            if update { try dump.write(to: path, atomically: true, encoding: .utf8) }
            XCTAssertEqual(dump, try String(contentsOf: path, encoding: .utf8), name)
            XCTAssertEqual(calls, 0, "View inspection must not activate \(name)")
        }
        let actual = Set(try FileManager.default.contentsOfDirectory(atPath: directory.path))
        XCTAssertEqual(actual, expected, "Missing/stale/extra goldens must not silently survive")
    }

    func testProjectionDetectsTextControlStateAndEmptyRegression() throws {
        XCTAssertNotEqual(try NativeViewDump.render(Text("Before")), try NativeViewDump.render(Text("After")))
        let button = Button("Open") { XCTFail("Dump invoked a button") }
        XCTAssertNotEqual(try NativeViewDump.render(button), try NativeViewDump.render(button.disabled(true)))
        XCTAssertThrowsError(try NativeViewDump.render(EmptyView()))
        XCTAssertThrowsError(try NativeViewDump.render(Button("") {}))
        let malformed = Picker("Malformed", selection: Binding<Data?>.constant(Data("id".utf8))) {
            Text("Missing option tag")
        }
        XCTAssertThrowsError(try NativeViewDump.render(malformed))
    }

    func testProjectionRecordsRealPickerSelectionAndDeclaredLabel() throws {
        var panel = Meridian_Ui_V1_ChoicePanel()
        panel.options = ["First", "Second"].map { label in
            var option = Meridian_Ui_V1_ChoiceOption()
            option.id = label
            option.label = label
            return option
        }
        let state = NativeSelectionState()
        let view = ChoiceContent(panel: panel, selection: state)
        let first = try NativeViewDump.render(view)
        XCTAssertTrue(first.contains("option \"First\" selected=true"))
        try view.inspect().find(ViewType.Picker.self).select(value: Optional(Data("Second".utf8)))
        let second = try NativeViewDump.render(view)
        XCTAssertTrue(second.contains("option \"Second\" selected=true"))
        XCTAssertNotEqual(first, second)
        let declared = try NativeViewDump.render(Text("Visible").accessibilityLabel("Declared alternative"))
        XCTAssertTrue(declared.contains("declared-label=\"Declared alternative\""))
    }
}
