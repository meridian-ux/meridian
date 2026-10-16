import SwiftUI
import ViewInspector
import XCTest
@testable import MeridianUI

@MainActor
final class ContentFlowTests: XCTestCase {
    func testStepsRealBodyContainsLabelsNumbersActorsAndFallbacks() throws {
        let descriptor = try XCTUnwrap(SchemaTests.fixtures().first { $0.0 == "steps.binpb" }?.1)
        let view = StepsContent(panel: descriptor.steps, host: MeridianHost())
        let texts = try view.inspect().findAll(ViewType.Text.self).map { try $0.string() }
        // An authored, ordered view-text golden, not descriptor-derived output
        // and not a computed accessibility-tree snapshot.
        XCTAssertEqual(texts, [
            "Add an employer and confirm a colleague can see it.",
            "1. Open the Sponsors page",
            "The list of every employer your organization administers.",
            "Admin", "The sponsors list", "Open Sponsors", "Continue in the sponsor list",
            "2. Add a new sponsor",
            "Name it, then set Status to Active and Kind to Customer.", "Admin",
            "3. Confirm a colleague sees it",
            "Everyone in your organization shares one sponsor list.", "Manager",
            "The sponsor is now visible to your whole team.",
        ])
    }

    func testConnectRealPickerChangesVisibleTargetWithoutInvokingHost() throws {
        let descriptor = try XCTUnwrap(SchemaTests.fixtures().first { $0.0 == "connect_flow.binpb" }?.1)
        let state = NativeSelectionState()
        var calls = 0
        let host = MeridianHost(admit: { _ in calls += 1; return .allow }, execute: { _ in calls += 1 })
        let view = ConnectFlowContent(panel: descriptor.connectFlow, host: host, selection: state)
        let picker = try view.inspect().find(ViewType.Picker.self)
        let targets = descriptor.connectFlow.targets
        XCTAssertEqual(targets.count, 2)
        XCTAssertEqual(try picker.selectedValue(Data?.self), Data(targets[0].id.utf8))
        try picker.select(value: Optional(Data(targets[1].id.utf8)))
        XCTAssertEqual(try view.inspect().find(ViewType.Picker.self).selectedValue(Data?.self), Data(targets[1].id.utf8))
        let texts = try view.inspect().findAll(ViewType.Text.self).map { try $0.string() }
        XCTAssertTrue(texts.contains(targets[1].description_p))
        XCTAssertFalse(texts.contains(targets[0].description_p))
        XCTAssertTrue(texts.contains(targets[1].configs[0].content))
        XCTAssertFalse(texts.contains(targets[0].configs[0].content))
        XCTAssertFalse(texts.contains("Add to Cursor"))
        XCTAssertEqual(calls, 0)
    }

    func testStepButtonRechecksPolicyAndPreservesRawAction() async throws {
        let panel = try XCTUnwrap(SchemaTests.fixtures().first { $0.0 == "steps.binpb" }?.1).steps
        var permitted = false
        var requests: [MeridianActivation] = []
        let host = MeridianHost(admit: { _ in permitted ? .allow : .deny("Not allowed.") },
                                execute: { requests.append($0) })
        let view = StepsContent(panel: panel, host: host)
        let button = try view.inspect().find(ViewType.Button.self)
        XCTAssertFalse(button.isDisabled())
        XCTAssertTrue(requests.isEmpty)
        try button.tap()
        for _ in 0..<1000 {
            if !host.feedback.isEmpty { break }
            await Task.yield()
        }
        XCTAssertEqual(host.feedback, "Not allowed.")
        XCTAssertTrue(requests.isEmpty)
        permitted = true
        try button.tap()
        for _ in 0..<1000 {
            if !requests.isEmpty { break }
            await Task.yield()
        }
        XCTAssertEqual(requests, [.affordance(panel.steps[0].action)])
    }

    func testSelectedConnectionConfigCopiesExactRawBytes() async throws {
        var panel = try XCTUnwrap(SchemaTests.fixtures().first { $0.0 == "connect_flow.binpb" }?.1).connectFlow
        let raw = " raw\u{0} e\u{301}\n"
        panel.targets[1].configs[0].content = raw
        let state = NativeSelectionState()
        var requests: [MeridianActivation] = []
        let host = MeridianHost(admit: { _ in .allow }, execute: { requests.append($0) })
        let view = ConnectFlowContent(panel: panel, host: host, selection: state)
        try view.inspect().find(ViewType.Picker.self).select(value: Optional(Data(panel.targets[1].id.utf8)))
        let buttons = try view.inspect().findAll(ViewType.Button.self)
        // Endpoint copy and the selected target's one config; no inactive action.
        XCTAssertEqual(buttons.count, 2)
        let copy = try XCTUnwrap(buttons.first {
            try $0.labelView().findAll(ViewType.Text.self).map { try $0.string() }.contains("Copy snippet")
        })
        try copy.tap()
        for _ in 0..<1000 {
            if !requests.isEmpty { break }
            await Task.yield()
        }
        guard case .copy(let actual)? = requests.first else { return XCTFail("Missing raw copy") }
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(Data(actual.utf8), Data(raw.utf8))
    }

    func testInvalidConnectionIDsHaveNoPickerOrTargetEffects() throws {
        var panel = try XCTUnwrap(SchemaTests.fixtures().first { $0.0 == "connect_flow.binpb" }?.1).connectFlow
        for badID in ["", panel.targets[0].id] {
            panel.targets[1].id = badID
            let view = ConnectFlowContent(panel: panel, host: MeridianHost(), selection: NativeSelectionState())
            XCTAssertTrue(try view.inspect().findAll(ViewType.Picker.self).isEmpty)
            let texts = try view.inspect().findAll(ViewType.Text.self).map { try $0.string() }
            XCTAssertTrue(texts.contains("Connection targets need nonempty, unique IDs."))
            XCTAssertFalse(texts.contains("Add to Cursor"))
            // Invalid target data does not hide the independent endpoint.
            XCTAssertTrue(texts.contains(panel.endpoint.value))
        }
    }

    func testChoiceUsesExactBytesAndFallsBackWhenSelectionRemoved() throws {
        var panel = Meridian_Ui_V1_ChoicePanel()
        panel.options = ["é", "e\u{301}"].map { id in
            var option = Meridian_Ui_V1_ChoiceOption()
            option.id = id
            option.label = id
            option.description_p = "Description \(id)"
            return option
        }
        panel.defaultOptionID = panel.options[1].id
        let state = NativeSelectionState()
        let view = ChoiceContent(panel: panel, selection: state)
        let picker = try view.inspect().find(ViewType.Picker.self)
        XCTAssertEqual(try picker.selectedValue(Data?.self), Data(panel.options[1].id.utf8))
        try picker.select(value: Optional(Data(panel.options[0].id.utf8)))
        panel.options.reverse()
        let reordered = ChoiceContent(panel: panel, selection: state)
        XCTAssertEqual(try reordered.inspect().find(ViewType.Picker.self).selectedValue(Data?.self), Data("é".utf8))
        panel.options.removeLast()
        let removed = ChoiceContent(panel: panel, selection: state)
        XCTAssertEqual(try removed.inspect().find(ViewType.Picker.self).selectedValue(Data?.self), Data("e\u{301}".utf8))
    }

    func testMediaAndSymbolsOnlyUseExactHostAdmittedKeys() throws {
        var panel = try XCTUnwrap(SchemaTests.fixtures().first { $0.0 == "steps.binpb" }?.1).steps
        panel.steps = [panel.steps[0]]
        panel.steps[0].mediaUri = "é"
        let host = MeridianHost(images: [Data("e\u{301}".utf8): Image(systemName: "checkmark")],
                                symbols: [Data("open".utf8): "arrow.up.right"])
        XCTAssertNil(host.image(for: "é"))
        XCTAssertNotNil(host.image(for: "e\u{301}"))
        let view = StepsContent(panel: panel, host: host)
        XCTAssertTrue(try view.inspect().findAll(ViewType.Text.self).map { try $0.string() }.contains("The sponsors list"))
        let symbols = try view.inspect().findAll(ViewType.Image.self).map { try $0.actualImage().name() }
        XCTAssertTrue(symbols.contains("arrow.up.right"))
        XCTAssertFalse(symbols.contains("checkmark"))
        host.images[Data("é".utf8)] = Image(systemName: "checkmark")
        let admitted = try view.inspect().findAll(ViewType.Image.self)
        let image = try XCTUnwrap(admitted.first { try $0.actualImage().name() == "checkmark" })
        XCTAssertEqual(try image.accessibilityLabel().string(), "The sponsors list")
    }

    func testEmptyFlowsAreExplicit() throws {
        let steps = StepsContent(panel: .init(), host: MeridianHost())
        XCTAssertEqual(try steps.inspect().findAll(ViewType.Text.self).map { try $0.string() }, ["No steps."])
        let connect = ConnectFlowContent(panel: .init(), host: MeridianHost(), selection: NativeSelectionState())
        XCTAssertEqual(try connect.inspect().findAll(ViewType.Text.self).map { try $0.string() }, ["No connection targets."])
        XCTAssertTrue(try connect.inspect().findAll(ViewType.Button.self).isEmpty)
    }

    func testHiddenCopyValueViewDoesNotExposeSecretButCopiesRaw() async throws {
        var value = Meridian_Ui_V1_CopyValue()
        value.value = "secret\u{0}e\u{301}"
        value.secret = true
        var copied: String?
        let host = MeridianHost(admit: { _ in .allow }, execute: {
            if case .copy(let raw) = $0 { copied = raw }
        })
        let view = CopyValueContent(value: value, host: host)
        let texts = try view.inspect().findAll(ViewType.Text.self).map { try $0.string() }
        XCTAssertFalse(texts.contains(value.value))
        XCTAssertTrue(texts.contains("••••••••"))
        let copy = try XCTUnwrap(view.inspect().findAll(ViewType.Button.self).first {
            try $0.labelView().findAll(ViewType.Text.self).map { try $0.string() }.contains("Copy value")
        })
        try copy.tap()
        for _ in 0..<1000 {
            if copied != nil { break }
            await Task.yield()
        }
        XCTAssertEqual(copied.map { Data($0.utf8) }, Data(value.value.utf8))
    }

    func testUnknownPanelActualViewExplainsWithoutEffects() throws {
        let descriptor = try Meridian_Ui_V1_PanelDescriptor(serializedBytes: Data([0xd2, 0x0f, 0x00]))
        var calls = 0
        let host = MeridianHost(admit: { _ in calls += 1; return .allow }, execute: { _ in calls += 1 })
        let view = MeridianPanel(descriptor, host: host)
        XCTAssertEqual(try view.inspect().findAll(ViewType.Text.self).map { try $0.string() },
                       ["This panel has no supported content. It may require a newer renderer."])
        XCTAssertTrue(try view.inspect().findAll(ViewType.Button.self).isEmpty)
        XCTAssertEqual(calls, 0)
    }
}
