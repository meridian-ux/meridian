import XCTest
@testable import MeridianUI

final class RequestCoreTests: XCTestCase {
    func testEverySharedRequestGoldenExecutesTheActualRustBuilder() throws {
        let cases = try CoreTests.corpus().requests
        XCTAssertEqual(cases.count, 6)
        for test in cases {
            let call = try Meridian_Ui_V1_RpcCall(serializedBytes: test.rpc)
            let fields = test.context.structValue.fields
            var context = Meridian_Ui_V1_RequestContext()
            if let path = fields["currentResourcePath"] { context.currentResourcePath = path.stringValue }
            if let identity = fields["uiIdentity"] { context.uiIdentity = identity }
            if let row = fields["selectedRow"] { context.selectedRow = row }
            func bag(_ name: String) -> [Meridian_Ui_V1_ContextValue] {
                (fields[name]?.structValue.fields ?? [:]).sorted { $0.key < $1.key }.map { key, value in
                    var entry = Meridian_Ui_V1_ContextValue(); entry.key = key; entry.value = value; return entry
                }
            }
            context.formValues = bag("formValues")
            context.selections = bag("selections")
            XCTAssertEqual(try MeridianCore.buildRequest(call, context: context), test.expected, test.name)
        }
    }

    func testExactContextNamesStayDistinctAndDuplicateNamesFail() throws {
        var call = Meridian_Ui_V1_RpcCall()
        var context = Meridian_Ui_V1_RequestContext()
        for (name, field) in [("é", "composed"), ("e\u{301}", "decomposed")] {
            var binding = Meridian_Ui_V1_FieldBinding(); binding.requestField = field; binding.selectionKey = name
            call.bindings.append(binding)
            var entry = Meridian_Ui_V1_ContextValue(); entry.key = name; entry.value.stringValue = field
            context.selections.append(entry)
        }
        let result = try MeridianCore.buildRequest(call, context: context)
        XCTAssertEqual(result.structValue.fields["composed"]?.stringValue, "composed")
        XCTAssertEqual(result.structValue.fields["decomposed"]?.stringValue, "decomposed")
        context.selections.append(context.selections[0])
        XCTAssertThrowsError(try MeridianCore.buildRequest(call, context: context)) {
            XCTAssertEqual($0 as? MeridianCoreError, .nativeStatus(2))
        }
    }

    func testSignalAndEmptyResourcePresenceAndNativeCaps() throws {
        var call = Meridian_Ui_V1_RpcCall()
        var resource = Meridian_Ui_V1_FieldBinding(); resource.requestField = "resource"; resource.context = .currentResourcePath
        var signal = Meridian_Ui_V1_FieldBinding(); signal.requestField = "signal"; signal.signal = "brush"
        call.bindings = [resource, signal]
        var context = Meridian_Ui_V1_RequestContext()
        XCTAssertTrue(try MeridianCore.buildRequest(call, context: context).structValue.fields.isEmpty)
        context.currentResourcePath = ""
        var entry = Meridian_Ui_V1_ContextValue(); entry.key = "brush"; entry.value.boolValue = false
        context.signals = [entry]
        let result = try MeridianCore.buildRequest(call, context: context)
        XCTAssertEqual(result.structValue.fields["resource"]?.stringValue, "")
        XCTAssertEqual(result.structValue.fields["signal"]?.boolValue, false)
        context.currentResourcePath = String(repeating: "x", count: 1024 * 1024 + 1)
        XCTAssertThrowsError(try MeridianCore.buildRequest(call, context: context)) {
            XCTAssertEqual($0 as? MeridianCoreError, .nativeStatus(3))
        }
    }

    func testCoreRejectsDeepPathsAndOverwrittenCopyAmplificationBeforeDispatch() throws {
        var binding = Meridian_Ui_V1_FieldBinding()
        binding.requestField = String(repeating: "a.", count: 32_000) + "leaf"
        binding.literal = "value"
        var call = Meridian_Ui_V1_RpcCall()
        call.bindings = [binding]
        XCTAssertLessThan(try call.serializedData().count, 64 * 1024)
        XCTAssertThrowsError(try MeridianCore.buildRequest(call, context: .init())) {
            XCTAssertEqual($0 as? MeridianCoreError, .nativeStatus(3))
        }
        binding.requestField = "same"
        binding.context = .uiIdentity
        call.bindings = Array(repeating: binding, count: 10)
        var context = Meridian_Ui_V1_RequestContext()
        context.uiIdentity.stringValue = String(repeating: "x", count: 700_000)
        XCTAssertLessThan(try context.serializedData().count, 1024 * 1024)
        XCTAssertThrowsError(try MeridianCore.buildRequest(call, context: context)) {
            XCTAssertEqual($0 as? MeridianCoreError, .nativeStatus(3))
        }
    }
}
