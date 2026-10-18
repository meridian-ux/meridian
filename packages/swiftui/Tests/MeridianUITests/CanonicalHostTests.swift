import XCTest
import ViewInspector
@testable import MeridianUI

@MainActor
final class CanonicalHostTests: XCTestCase {
    private func actions() -> [Meridian_Ui_V1_Affordance] {
        var route = Meridian_Ui_V1_Navigate()
        route.route = "/raw/e\u{301}"
        var panel = Meridian_Ui_V1_PanelDescriptor()
        panel.panelID = "nested"
        panel.choice = .init()
        var call = Meridian_Ui_V1_RpcCall()
        call.service = "test.Actions"
        call.method = "Get"
        let intents: [Meridian_Ui_V1_Affordance.OneOf_Invoke] = [
            .uri("https://example.test/raw"), .command("raw '$secret'\n"),
            .navigate(route), .openPanel(panel), .openView("view/e\u{301}"), .copy(""), .rpc(call),
        ]
        return intents.map { invoke in
            var action = Meridian_Ui_V1_Affordance()
            action.label = "Activate"
            action.invoke = invoke
            return action
        }
    }

    func testEveryCanonicalInvokeRequiresPolicyAndItsExplicitCapability() async {
        var fallback = 0
        let host = MeridianHost(execute: { _ in fallback += 1 })
        for action in actions() {
            await host.activate(.affordance(action))
            XCTAssertEqual(host.feedback, "This host has not enabled this action.")
        }
        host.admit = { _ in .allow }
        // URI/command alone retain their explicitly installed compatibility
        // callback. New canonical arms must not reach that old callback.
        for action in actions().dropFirst(2) {
            await host.activate(.affordance(action))
            XCTAssertEqual(host.feedback, "This host has not installed the required capability.")
            XCTAssertFalse(host.pending)
        }
        XCTAssertEqual(fallback, 0)
    }

    func testAllSevenTypedOperationsReceiveLiteralPayloadsAndCurrentContext() async throws {
        var calls: [String] = []
        var admissions = 0
        var capabilities = MeridianInvocationCapabilities()
        capabilities.uri = { value, context in
            XCTAssertEqual(value, "https://example.test/raw")
            XCTAssertEqual(context.currentResourcePath, "current")
            calls.append("uri")
        }
        capabilities.command = { value, _ in
            XCTAssertEqual(Data(value.utf8), Data("raw '$secret'\n".utf8)); calls.append("command")
        }
        capabilities.navigate = { target, _ in
            XCTAssertEqual(Data(target.route.utf8), Data("/raw/e\u{301}".utf8)); calls.append("navigate")
        }
        capabilities.openPanel = { target, _ in
            XCTAssertEqual(target.panelID, "nested"); XCTAssertNotNil(target.body); calls.append("panel")
        }
        capabilities.openView = { id, _ in
            XCTAssertEqual(Data(id.utf8), Data("view/e\u{301}".utf8)); calls.append("view")
        }
        capabilities.copy = { value, _ in XCTAssertEqual(value, ""); calls.append("copy") }
        var context = Meridian_Ui_V1_RequestContext()
        context.currentResourcePath = "current"
        let host = MeridianHost(admit: { _ in admissions += 1; return .allow }, execute: { _ in XCTFail("No legacy execution") },
            rpcContext: context, rpc: MeridianRpcCapability(
                admit: { _, _ in XCTFail("User RPC must not use read admission"); return .allow },
                admitMutation: { _, _ in .allow },
                invoke: { call, _ in XCTAssertEqual(call.method, "Get"); calls.append("rpc"); return .init() }),
            capabilities: capabilities)
        for (index, action) in actions().enumerated() {
            let view = AffordanceContent(action: action, host: host)
            let dump = try NativeViewDump.render(view)
            XCTAssertTrue(dump.contains("Activate"))
            XCTAssertEqual(calls.count, index, "Inspection cannot invoke a host capability")
            XCTAssertEqual(admissions, index, "Inspection cannot run admission")
            try view.inspect().find(ViewType.Button.self).tap()
            for _ in 0..<1000 {
                if calls.count == index + 1 && !host.pending { break }
                await Task.yield()
            }
            XCTAssertEqual(calls.count, index + 1)
            XCTAssertEqual(admissions, index + 1)
            XCTAssertEqual(host.feedback, "Completed.")
        }
        XCTAssertEqual(calls, ["uri", "command", "navigate", "panel", "view", "copy", "rpc"])
    }

    func testReadPermissionNeverGrantsUserTriggeredRpcEvenForGet() async {
        var reads = 0, invokes = 0
        let host = MeridianHost(admit: { _ in .allow }, rpc: MeridianRpcCapability(
            admit: { _, _ in reads += 1; return .allow },
            invoke: { _, _ in invokes += 1; return .init() }))
        await host.activate(.affordance(actions().last!))
        XCTAssertEqual(host.feedback, "This action request is not permitted.")
        XCTAssertEqual(reads, 0)
        XCTAssertEqual(invokes, 0)
    }

    func testPredicateUsesCurrentSelectionAndExactUnicodeThroughRust() async throws {
        var calls = 0
        var capabilities = MeridianInvocationCapabilities()
        capabilities.navigate = { _, _ in calls += 1 }
        let host = MeridianHost(admit: { _ in .allow }, capabilities: capabilities)
        var action = actions()[2]
        action.enabledWhen.fieldPath = "state"
        action.enabledWhen.equals = "é"
        await host.activate(.affordance(action))
        host.rpcContext.selectedRow = try Google_Protobuf_Value(jsonString: #"{"state":"e\u0301"}"#)
        await host.activate(.affordance(action))
        XCTAssertEqual(calls, 0)
        host.rpcContext.selectedRow = try Google_Protobuf_Value(jsonString: #"{"state":"é"}"#)
        await host.activate(.affordance(action))
        XCTAssertEqual(calls, 1)
        host.admit = { [weak host] _ in host?.rpcContext.clearSelectedRow(); return .allow }
        await host.activate(.affordance(action))
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(host.feedback, "This action is not enabled for the current selection.")
    }

    func testRpcBindingsAreBuiltFromCurrentContextAndCannotSurvivePolicyMutation() async {
        var invokes = 0
        let host = MeridianHost(admit: { _ in .allow })
        var action = actions().last!
        var binding = Meridian_Ui_V1_FieldBinding()
        binding.requestField = "subject"
        binding.context = .currentResourcePath
        action.rpc.bindings = [binding]
        host.rpcContext.currentResourcePath = "old"
        host.rpc = MeridianRpcCapability(admitMutation: { _, request in
            XCTAssertEqual(request.structValue.fields["subject"]?.stringValue, "new")
            return .allow
        }, invoke: { _, _ in invokes += 1; return .init() })
        host.rpcContext.currentResourcePath = "new"
        await host.activate(.affordance(action))
        XCTAssertEqual(invokes, 1)
        host.rpc = MeridianRpcCapability(admitMutation: { [weak host] _, _ in
            host?.rpcContext.currentResourcePath = "changed during admission"
            return .allow
        }, invoke: { _, _ in invokes += 1; return .init() })
        await host.activate(.affordance(action))
        XCTAssertEqual(invokes, 1)
        XCTAssertEqual(host.feedback, "This action request is not permitted.")
    }

    func testReplacingRpcCapabilityDuringAdmissionCannotInvokeEitherTransport() async {
        var calls = 0
        let host = MeridianHost(admit: { _ in .allow })
        host.rpc = MeridianRpcCapability(admitMutation: { [weak host] _, _ in
            host?.rpc = MeridianRpcCapability(admitMutation: { _, _ in .allow },
                invoke: { _, _ in calls += 1; return .init() })
            return .allow
        }, invoke: { _, _ in calls += 1; return .init() })
        await host.activate(.affordance(actions().last!))
        XCTAssertEqual(calls, 0)
        XCTAssertEqual(host.feedback, "This action request is not permitted.")
    }

    func testTypedPendingDuplicatesAndCancellationCannotFallThrough() async {
        var continuation: CheckedContinuation<Void, Never>?
        var calls = 0
        var capabilities = MeridianInvocationCapabilities()
        capabilities.navigate = { _, _ in
            calls += 1
            await withCheckedContinuation { continuation = $0 }
        }
        let host = MeridianHost(admit: { _ in .allow }, capabilities: capabilities)
        let action = actions()[2]
        let first = Task { await host.activate(.affordance(action)) }
        for _ in 0..<1000 {
            if continuation != nil { break }
            await Task.yield()
        }
        XCTAssertNotNil(continuation)
        XCTAssertTrue(host.pending)
        await host.activate(.affordance(action))
        XCTAssertEqual(calls, 1)
        first.cancel()
        continuation?.resume()
        await first.value
        XCTAssertFalse(host.pending)
        XCTAssertEqual(host.feedback, "Canceled.")
        host.admit = { _ in .deny("Current policy denied retry.") }
        await host.activate(.affordance(action))
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(host.feedback, "Current policy denied retry.")
    }

    func testTypedFailureOrDenialNeverFallsBackToCommandOrClipboard() async {
        struct Failed: Error {}
        var fallback = 0, copies = 0
        var capabilities = MeridianInvocationCapabilities()
        capabilities.command = { _, _ in throw Failed() }
        capabilities.copy = { _, _ in copies += 1 }
        let host = MeridianHost(admit: { _ in .allow }, execute: { _ in fallback += 1 }, capabilities: capabilities)
        await host.activate(.affordance(actions()[1]))
        XCTAssertEqual(host.feedback, "The action failed. Try again.")
        host.admit = { _ in .deny("Policy changed.") }
        await host.activate(.affordance(actions()[1]))
        XCTAssertEqual(host.feedback, "Policy changed.")
        XCTAssertEqual(fallback, 0)
        XCTAssertEqual(copies, 0)
    }
}
