import XCTest
@testable import MeridianUI

@MainActor
final class HostTests: XCTestCase {
    private func action(_ target: String = "https://example.test") -> Meridian_Ui_V1_Affordance {
        var result = Meridian_Ui_V1_Affordance()
        result.label = "Open"
        result.uri = target
        return result
    }

    func testDefaultDenyAndMissingCapability() async {
        let host = MeridianHost()
        await host.activate(.affordance(action()))
        XCTAssertEqual(host.feedback, "This host has not enabled this action.")
        host.admit = { _ in .allow }
        await host.activate(.copy(""))
        XCTAssertEqual(host.feedback, "This host has not installed the required capability.")
        XCTAssertFalse(host.pending)
    }

    func testCurrentPolicyIsRecheckedAndEmptyCopyIsNotDropped() async {
        var permitted = true
        var requests: [MeridianActivation] = []
        let host = MeridianHost(admit: { _ in permitted ? .allow : .deny("Policy changed.") },
                                execute: { requests.append($0) })
        await host.activate(.copy(""))
        XCTAssertEqual(requests, [.copy("")])
        permitted = false
        await host.activate(.affordance(action()))
        XCTAssertEqual(requests, [.copy("")])
        XCTAssertEqual(host.feedback, "Policy changed.")
    }

    func testRawCommandAndClipboardPayloadsAreNotReinterpreted() async {
        var requests: [MeridianActivation] = []
        let host = MeridianHost(admit: { _ in .allow }, execute: { requests.append($0) })
        var command = action()
        command.command = "printf '$secret' && exit 1\n"
        await host.activate(.affordance(command))
        await host.activate(.copy(" raw\nvalue "))
        XCTAssertEqual(requests, [.affordance(command), .copy(" raw\nvalue ")])
    }

    func testMissingAndUnknownTargetsCannotReachPolicyOrExecution() async throws {
        var calls = 0
        let host = MeridianHost(admit: { _ in calls += 1; return .allow },
                                execute: { _ in calls += 1 })
        await host.activate(.affordance(Meridian_Ui_V1_Affordance()))
        await host.activate(.affordance(action("")))
        let unknown = try Meridian_Ui_V1_Affordance(serializedBytes: Data([0xd2, 0x0f, 0x00]))
        await host.activate(.affordance(unknown))
        XCTAssertEqual(calls, 0)
    }

    func testPendingBlocksDuplicateActivation() async {
        var continuation: CheckedContinuation<Void, Never>?
        var calls = 0
        let host = MeridianHost(admit: { _ in .allow }, execute: { _ in
            calls += 1
            await withCheckedContinuation { continuation = $0 }
        })
        let first = Task { await host.activate(.copy("secret")) }
        for _ in 0..<1000 {
            if continuation != nil { break }
            await Task.yield()
        }
        XCTAssertNotNil(continuation)
        XCTAssertTrue(host.pending)
        await host.activate(.copy("duplicate"))
        XCTAssertEqual(calls, 1)
        continuation?.resume()
        await first.value
        XCTAssertFalse(host.pending)
        XCTAssertEqual(host.feedback, "Completed.")
    }

    func testFailureDoesNotEchoSecretAndRetryRechecksPolicy() async {
        struct SecretError: LocalizedError {
            var errorDescription: String? { "token=do-not-display" }
        }
        var calls = 0
        let host = MeridianHost(admit: { _ in .allow }, execute: { _ in
            calls += 1
            throw SecretError()
        })
        await host.activate(.copy("token=do-not-display"))
        XCTAssertEqual(host.feedback, "The action failed. Try again.")
        XCTAssertFalse(host.pending)
        host.admit = { _ in .deny("No longer allowed.") }
        await host.activate(.copy("token=do-not-display"))
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(host.feedback, "No longer allowed.")
    }

    func testCanceledActivationDoesNotExecute() async {
        var calls = 0
        let host = MeridianHost(admit: { _ in .allow }, execute: { _ in calls += 1 })
        let task = Task {
            withUnsafeCurrentTask { $0?.cancel() }
            await host.activate(.copy("not copied"))
        }
        await task.value
        XCTAssertEqual(calls, 0)
        XCTAssertEqual(host.feedback, "Canceled.")
        XCTAssertFalse(host.pending)
    }
}
