import SwiftUI
import ViewInspector
import XCTest
@testable import MeridianUI

@MainActor
final class NativeFormTests: XCTestCase {
    func testCanonicalEditorAddsAndRemovesNestedRows() throws {
        let descriptor = try XCTUnwrap(SchemaTests.fixtures().first { $0.0 == "form.binpb" }?.1)
        let repeated = try XCTUnwrap(descriptor.form.fields.first).repeated
        var values = Google_Protobuf_Value()
        values.listValue = .init()
        let view = NativeRepeatedField(spec: repeated, value: Binding(
            get: { values }, set: { values = $0 }
        ), editable: true)

        try view.inspect().find(button: "Add section").tap()
        XCTAssertEqual(values.listValue.values.count, 1)
        let entry = try XCTUnwrap(values.listValue.values.first)
        XCTAssertEqual(entry.structValue.fields["label"]?.stringValue, "")
        XCTAssertEqual(entry.structValue.fields["kinds"]?.listValue.values, [])
        try view.inspect().find(button: "Add kind").tap()
        XCTAssertEqual(values.listValue.values.first?.structValue.fields["kinds"]?.listValue.values.count, 1)
        try view.inspect().findAll(ViewType.Button.self).last { button in
            (try? button.labelView().text().string()) == "Remove item"
        }.map { try $0.tap() }
        XCTAssertTrue(values.listValue.values.isEmpty)
    }

    func testPrefillUsesDeclaredFieldsAndSubmitValidatesBeforeMutation() async throws {
        let descriptor = try XCTUnwrap(SchemaTests.fixtures().first { $0.0 == "form.binpb" }?.1)
        var form = descriptor.form
        var submit = Meridian_Ui_V1_RpcCall()
        submit.service = "example.Navigation"
        submit.method = "Update"
        form.submitAffordance.rpc = submit
        var field = Meridian_Ui_V1_FormField()
        field.fieldID = "slug"
        field.text.pattern = "^[a-z]+$"
        form.fields.append(field)
        let prefill = try Google_Protobuf_Value(jsonString: """
            {"groups":[{"label":"Operations","kinds":["workspace"],"extra":"ignore"}],"slug":"good","admin":true}
            """)
        let edited = try NativeFormValues.initial(form.fields, prefill: prefill)
        let values = NativeFormValues.submission(form.fields, values: edited)
        XCTAssertNil(values.structValue.fields["admin"])
        XCTAssertNil(values.structValue.fields["groups"]?.listValue.values.first?.structValue.fields["extra"])
        var invalid = values
        invalid.structValue.fields["slug"] = Google_Protobuf_Value(stringLiteral: "bad-slug")
        var admissions = 0
        var invoked: [Google_Protobuf_Value] = []
        let rpc = MeridianRpcCapability(
            admit: { _, _ in XCTFail("Save used read admission"); return .deny("") },
            admitMutation: { _, _ in admissions += 1; return .allow },
            invoke: { _, request in invoked.append(request); return .init() }
        )
        let host = MeridianHost(admit: { _ in .allow }, rpc: rpc)
        await host.submit(form, values: invalid)
        XCTAssertEqual(admissions, 0)
        XCTAssertTrue(invoked.isEmpty)
        await host.submit(form, values: values)
        XCTAssertEqual(admissions, 1)
        XCTAssertEqual(invoked, [values])
        XCTAssertTrue(host.rpcContext.formValues.isEmpty)
    }
}
