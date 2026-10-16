import AppKit
import SwiftUI
import ViewInspector
import XCTest
@testable import MeridianUI

@MainActor
final class LiveStatTests: XCTestCase {
    private func panel() -> Meridian_Ui_V1_StatPanel {
        var panel = Meridian_Ui_V1_StatPanel()
        panel.label = "Latency"
        panel.value = 7
        panel.previous = 3
        panel.unit = "ms"
        panel.higherIsBetter = false
        panel.populate.service = "test.Metrics"
        panel.populate.method = "Read"
        var binding = Meridian_Ui_V1_FieldBinding()
        binding.requestField = "resource"
        binding.context = .currentResourcePath
        panel.populate.bindings = [binding]
        return panel
    }

    private func waitUntil(_ predicate: () -> Bool) async {
        for _ in 0..<1000 {
            if predicate() { return }
            await Task.yield()
        }
        XCTFail("Expected asynchronous state transition")
    }

    func testActualViewUsesCoreLabelsAndDoesNotAdmitDuringInspection() throws {
        var calls = 0
        let host = MeridianHost(rpc: MeridianRpcCapability(admit: { _, _ in calls += 1; return .allow }, invoke: { _, _ in
            calls += 1; return .init()
        }))
        let view = StatContent(panel: panel(), host: host, state: NativeStatState())
        let dump = try NativeViewDump.render(view)
        XCTAssertTrue(dump.contains("\"7 ms\""))
        XCTAssertTrue(dump.contains("\"Increasing: +4\""))
        XCTAssertTrue(dump.contains("\"Unfavorable change\""))
        XCTAssertTrue(dump.contains("\"Loading metric…\""))
        XCTAssertEqual(calls, 0)
    }

    func testDefaultMissingCapabilityAndDefaultDenyAreInert() async throws {
        let panel = panel(), state = NativeStatState(), host = MeridianHost()
        await state.load(panel: panel, host: host, key: try NativeStatIdentity(panel: panel, host: host))
        XCTAssertEqual(state.message, "This host has no metric data capability.")
        var calls = 0
        host.rpc = MeridianRpcCapability(invoke: { _, _ in calls += 1; return .init() })
        await state.load(panel: panel, host: host, key: try NativeStatIdentity(panel: panel, host: host))
        XCTAssertEqual(state.message, "This metric request is not permitted.")
        XCTAssertFalse(state.pending)
        XCTAssertNil(state.response)
        XCTAssertEqual(calls, 0)
    }

    func testAdmissionSeesBuiltRequestAndRetryButtonRechecksPolicy() async throws {
        let panel = panel(), state = NativeStatState()
        var permitted = false
        var admitted: [Google_Protobuf_Value] = []
        var invoked = 0
        var context = Meridian_Ui_V1_RequestContext()
        context.currentResourcePath = " raw\u{0}e\u{301} "
        let response = try Google_Protobuf_Value(jsonString: #"{"value":0,"previous":2}"#)
        let host = MeridianHost(rpcContext: context, rpc: MeridianRpcCapability(admit: { call, request in
            XCTAssertEqual(call, panel.populate)
            admitted.append(request)
            return permitted ? .allow : .deny("secret must not appear")
        }, invoke: { call, request in
            XCTAssertEqual(call, panel.populate)
            XCTAssertEqual(request, admitted.last)
            invoked += 1
            return response
        }))
        await state.load(panel: panel, host: host, key: try NativeStatIdentity(panel: panel, host: host))
        XCTAssertEqual(invoked, 0)
        let actual = try XCTUnwrap(admitted.first?.structValue.fields["resource"]?.stringValue)
        XCTAssertEqual(Data(actual.utf8), Data(context.currentResourcePath.utf8))
        let view = StatContent(panel: panel, host: host, state: state)
        XCTAssertFalse(try NativeViewDump.render(view).contains("secret must not appear"))
        permitted = true
        try view.inspect().find(ViewType.Button.self).tap()
        await waitUntil { state.response != nil }
        XCTAssertEqual(admitted.count, 2)
        XCTAssertEqual(invoked, 1)
        let dump = try NativeViewDump.render(view)
        XCTAssertTrue(dump.contains("\"0 ms\""))
        XCTAssertTrue(dump.contains("\"Decreasing: -2\""))
        XCTAssertTrue(dump.contains("\"Favorable change\""))
    }

    func testDuplicateLoadIsSuppressedAndOlderContextCannotOverwriteNewResponse() async throws {
        let panel = panel(), state = NativeStatState()
        var continuations: [CheckedContinuation<Google_Protobuf_Value, Never>] = []
        let host = MeridianHost(rpc: MeridianRpcCapability(admit: { _, _ in .allow }, invoke: { _, _ in
            await withCheckedContinuation { continuations.append($0) }
        }))
        host.rpcContext.currentResourcePath = "old"
        let oldKey = try NativeStatIdentity(panel: panel, host: host)
        let first = Task { await state.load(panel: panel, host: host, key: oldKey) }
        await waitUntil { continuations.count == 1 }
        await state.load(panel: panel, host: host, key: oldKey)
        XCTAssertEqual(continuations.count, 1)
        XCTAssertTrue(state.pending)
        host.rpcContext.currentResourcePath = "new"
        let newKey = try NativeStatIdentity(panel: panel, host: host)
        let second = Task { await state.load(panel: panel, host: host, key: newKey) }
        await waitUntil { continuations.count == 2 }
        XCTAssertEqual(continuations.count, 2)
        continuations[1].resume(returning: try Google_Protobuf_Value(jsonString: #"{"value":20}"#))
        await second.value
        XCTAssertEqual(state.response?.structValue.fields["value"]?.numberValue, 20)
        // Deliberately noncooperative transport: old request finishes last.
        continuations[0].resume(returning: try Google_Protobuf_Value(jsonString: #"{"value":99}"#))
        await first.value
        XCTAssertEqual(state.key, newKey)
        XCTAssertEqual(state.response?.structValue.fields["value"]?.numberValue, 20)
        XCTAssertFalse(state.pending)
    }

    func testContextAndCapabilityReplacementHideOldDataBeforeNextLoad() async throws {
        let panel = panel(), state = NativeStatState()
        let response = try Google_Protobuf_Value(jsonString: #"{"value":100}"#)
        let host = MeridianHost(rpc: MeridianRpcCapability(admit: { _, _ in .allow }, invoke: { _, _ in response }))
        host.rpcContext.currentResourcePath = "é"
        let key = try NativeStatIdentity(panel: panel, host: host)
        await state.load(panel: panel, host: host, key: key)
        let view = StatContent(panel: panel, host: host, state: state)
        XCTAssertTrue(try NativeViewDump.render(view).contains("\"100 ms\""))
        host.rpcContext.currentResourcePath = "e\u{301}"
        XCTAssertNotEqual(key, try NativeStatIdentity(panel: panel, host: host))
        XCTAssertFalse(try NativeViewDump.render(view).contains("\"100 ms\""))
        host.rpcContext.currentResourcePath = "é"
        host.rpc = MeridianRpcCapability(invoke: { _, _ in XCTFail("Default deny"); return response })
        XCTAssertNotEqual(key, try NativeStatIdentity(panel: panel, host: host))
        XCTAssertFalse(try NativeViewDump.render(view).contains("\"100 ms\""))
    }

    func testCancelInvalidatesNoncooperativeResponseAndFailuresDoNotEcho() async throws {
        let panel = panel(), state = NativeStatState()
        var continuation: CheckedContinuation<Google_Protobuf_Value, Never>?
        let host = MeridianHost(rpc: MeridianRpcCapability(admit: { _, _ in .allow }, invoke: { _, _ in
            await withCheckedContinuation { continuation = $0 }
        }))
        let task = Task { await state.load(panel: panel, host: host, key: try! NativeStatIdentity(panel: panel, host: host)) }
        await waitUntil { continuation != nil }
        let view = StatContent(panel: panel, host: host, state: state)
        try view.body.inspect().callOnDisappear()
        XCTAssertFalse(state.pending)
        XCTAssertNil(state.key)
        continuation?.resume(returning: try Google_Protobuf_Value(jsonString: #"{"value":99}"#))
        await task.value
        XCTAssertNil(state.response)
        struct SecretFailure: LocalizedError { var errorDescription: String? { "token=do-not-echo" } }
        host.rpc = MeridianRpcCapability(admit: { _, _ in .allow }, invoke: { _, _ in throw SecretFailure() })
        await state.load(panel: panel, host: host, key: try NativeStatIdentity(panel: panel, host: host))
        XCTAssertEqual(state.message, "Metric data could not be loaded. Try again.")
        XCTAssertFalse(try NativeViewDump.render(StatContent(panel: panel, host: host, state: state)).contains("token=do-not-echo"))
        host.rpc = MeridianRpcCapability(admit: { _, _ in .allow }, invoke: { _, _ in try Google_Protobuf_Value(jsonString: "[]") })
        await state.load(panel: panel, host: host, key: try NativeStatIdentity(panel: panel, host: host))
        XCTAssertNil(state.response)
        XCTAssertEqual(state.message, "Metric data could not be loaded. Try again.")
        var invalidNumber = Google_Protobuf_Value()
        invalidNumber.numberValue = .nan
        var nonfinite = Google_Protobuf_Value()
        nonfinite.structValue.fields["value"] = invalidNumber
        host.rpc = MeridianRpcCapability(admit: { _, _ in .allow }, invoke: { _, _ in nonfinite })
        await state.load(panel: panel, host: host, key: try NativeStatIdentity(panel: panel, host: host))
        XCTAssertNil(state.response)
        XCTAssertEqual(state.message, "Metric data could not be loaded. Try again.")
    }

    func testSparklineGeometryIsBoundedAndOverflowSafe() {
        let rect = CGRect(x: 5, y: 10, width: 100, height: 40)
        for series in [[0, 0], [-Double.greatestFiniteMagnitude, Double.greatestFiniteMagnitude], [1, 2, 3]] {
            let points = NativeSparkline.points(series, in: rect)
            XCTAssertEqual(points.count, series.count)
            XCTAssertEqual(points.first?.x, rect.minX)
            XCTAssertEqual(points.last?.x, rect.maxX)
            for point in points {
                XCTAssertTrue(point.x.isFinite && point.y.isFinite)
                XCTAssertTrue(point.x >= rect.minX && point.x <= rect.maxX)
                XCTAssertTrue(point.y >= rect.minY && point.y <= rect.maxY)
            }
        }
        XCTAssertEqual(NativeSparkline.points(Array(repeating: 1, count: 10_000), in: rect).count, 256)
        XCTAssertTrue(NativeSparkline.points([0, .infinity], in: rect).isEmpty)
        XCTAssertTrue(NativeSparkline.points([0, .nan], in: rect).isEmpty)
    }

    func testParentTaskCancellationReachesCooperativeTransport() async throws {
        let panel = panel(), state = NativeStatState()
        var started = false
        let host = MeridianHost(rpc: MeridianRpcCapability(admit: { _, _ in .allow }, invoke: { _, _ in
            started = true
            try await Task.sleep(for: .seconds(5))
            XCTFail("Transport was not canceled")
            return .init()
        }))
        let key = try NativeStatIdentity(panel: panel, host: host)
        let task = Task { await state.load(panel: panel, host: host, key: key) }
        await waitUntil { started }
        task.cancel()
        await task.value
        XCTAssertFalse(state.pending)
        XCTAssertNil(state.response)
        XCTAssertEqual(state.message, "Metric loading canceled.")
    }

    func testMountedTaskLoadsThroughAdmissionAndCore() async throws {
        let panel = panel(), state = NativeStatState()
        var calls = 0
        let host = MeridianHost(rpc: MeridianRpcCapability(admit: { _, _ in calls += 1; return .allow }, invoke: { _, _ in
            calls += 1
            return try Google_Protobuf_Value(jsonString: #"{"value":12,"previous":0}"#)
        }))
        let view = StatContent(panel: panel, host: host, state: state)
        XCTAssertEqual(calls, 0)
        _ = NSApplication.shared
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 320, height: 240),
                              styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        let hosting = NSHostingView(rootView: view)
        window.contentView = hosting
        defer { window.orderOut(nil); window.close() }
        window.orderFront(nil) // Own short-lived test window; never activate another app.
        window.layoutIfNeeded()
        for _ in 0..<100 {
            if state.response != nil { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(calls, 2)
        XCTAssertFalse(state.pending)
        XCTAssertTrue(try NativeViewDump.render(view).contains("\"12 ms\""))
        var staticPanel = panel
        staticPanel.clearPopulate()
        hosting.rootView = StatContent(panel: staticPanel, host: host, state: state)
        for _ in 0..<100 {
            if state.key == nil { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertNil(state.key)
        XCTAssertNil(state.response)
        XCTAssertEqual(calls, 2, "Removing populate must clear cached data without another RPC")
    }

    func testInvalidAndStaleRequestsNeverReachAdmission() async throws {
        var panel = panel()
        var calls = 0
        let state = NativeStatState()
        let host = MeridianHost(rpc: MeridianRpcCapability(admit: { _, _ in calls += 1; return .allow }, invoke: { _, _ in
            calls += 1; return .init()
        }))
        let old = try NativeStatIdentity(panel: panel, host: host)
        host.rpcContext.currentResourcePath = "replacement"
        await state.load(panel: panel, host: host, key: old)
        XCTAssertFalse(state.pending)
        panel.populate.service = ""
        await state.load(panel: panel, host: host, key: try NativeStatIdentity(panel: panel, host: host))
        XCTAssertEqual(state.message, "This metric has no usable data source.")
        panel.populate.service = "test.Metrics"
        var entry = Meridian_Ui_V1_ContextValue(); entry.key = "duplicate"; entry.value.numberValue = 0
        host.rpcContext.selections = [entry, entry]
        await state.load(panel: panel, host: host, key: try NativeStatIdentity(panel: panel, host: host))
        XCTAssertEqual(state.message, "Metric data could not be loaded. Try again.")
        XCTAssertEqual(calls, 0)
    }
}
