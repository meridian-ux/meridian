import Combine
import MeridianProtos

/// In-process requests, not a serialized interchange type. No URL, shell, or
/// clipboard capability is installed by the renderer itself.
public enum MeridianActivation: Equatable, Sendable {
    case affordance(Meridian_Ui_V1_Affordance)
    case copy(String)
}

public enum MeridianAdmission: Equatable, Sendable {
    case allow
    case deny(String)
}

/// Hosts own policy and effects. Policy is reevaluated on every activation;
/// rendering, focus, and selection do not invoke it or run effects.
@MainActor
public final class MeridianHost: ObservableObject {
    @Published public private(set) var pending = false
    @Published public private(set) var feedback = ""

    public var admit: (MeridianActivation) -> MeridianAdmission
    public var execute: ((MeridianActivation) async throws -> Void)?

    public init(
        admit: @escaping (MeridianActivation) -> MeridianAdmission = { _ in
            .deny("This host has not enabled this action.")
        },
        execute: ((MeridianActivation) async throws -> Void)? = nil
    ) {
        self.admit = admit
        self.execute = execute
    }

    public func activate(_ request: MeridianActivation) async {
        guard !pending else { return }
        // Unknown future oneof data decodes as nil, not permission to fall back.
        if case .affordance(let action) = request {
            switch action.invoke {
            case .uri(let value), .command(let value):
                guard !value.isEmpty else {
                    feedback = "This action has no usable target."
                    return
                }
            case nil:
                feedback = "This action has no supported target."
                return
            }
        }
        switch admit(request) {
        case .deny(let reason):
            feedback = reason.isEmpty ? "This action is not permitted." : reason
            return
        case .allow: break
        }
        guard let execute else {
            feedback = "This host has not installed the required capability."
            return
        }
        pending = true
        feedback = "Working…"
        defer { pending = false }
        do {
            try Task.checkCancellation()
            try await execute(request)
            feedback = "Completed."
        } catch is CancellationError {
            feedback = "Canceled."
        } catch {
            // Errors and request descriptions may contain secrets. Do not echo.
            feedback = "The action failed. Try again."
        }
    }
}
