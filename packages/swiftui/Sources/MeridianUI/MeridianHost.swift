import Combine
import MeridianProtos
import SwiftUI

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

public enum MeridianRpcError: Error, Equatable {
    case unavailable, denied, invalidCall, invalidRequest, invalidResponse, failed
}

/// An in-process capability, never a serialized descriptor. Replace this object
/// to invalidate results when changing transport or authorization identity.
@MainActor
public final class MeridianRpcCapability {
    let identity = UUID()
    public let admit: (Meridian_Ui_V1_RpcCall, Google_Protobuf_Value) -> MeridianAdmission
    public let admitMutation: (Meridian_Ui_V1_RpcCall, Google_Protobuf_Value) -> MeridianAdmission
    public let invoke: (Meridian_Ui_V1_RpcCall, Google_Protobuf_Value) async throws -> Google_Protobuf_Value

    public init(
        admit: @escaping (Meridian_Ui_V1_RpcCall, Google_Protobuf_Value) -> MeridianAdmission = { _, _ in .deny("") },
        admitMutation: @escaping (Meridian_Ui_V1_RpcCall, Google_Protobuf_Value) -> MeridianAdmission = { _, _ in .deny("") },
        invoke: @escaping (Meridian_Ui_V1_RpcCall, Google_Protobuf_Value) async throws -> Google_Protobuf_Value
    ) {
        self.admit = admit
        self.admitMutation = admitMutation
        self.invoke = invoke
    }
}

/// Hosts own policy and effects. Policy is reevaluated on every activation;
/// rendering, focus, and selection do not invoke it or run effects.
@MainActor
public final class MeridianHost: ObservableObject {
    let identity = UUID()
    @Published public private(set) var pending = false
    @Published public private(set) var feedback = ""
    /// Host-admitted, already materialized images and icon-name mappings.
    /// Reading these never fetches a descriptor URI or invokes admission.
    @Published public var images: [Data: Image]
    @Published public var symbols: [Data: String]
    @Published public var rpcContext: Meridian_Ui_V1_RequestContext
    @Published public var rpc: MeridianRpcCapability?

    public var admit: (MeridianActivation) -> MeridianAdmission
    public var execute: ((MeridianActivation) async throws -> Void)?
    public var capabilities: MeridianInvocationCapabilities

    public init(
        admit: @escaping (MeridianActivation) -> MeridianAdmission = { _ in
            .deny("This host has not enabled this action.")
        },
        execute: ((MeridianActivation) async throws -> Void)? = nil,
        images: [Data: Image] = [:],
        symbols: [Data: String] = [:],
        rpcContext: Meridian_Ui_V1_RequestContext = .init(),
        rpc: MeridianRpcCapability? = nil,
        capabilities: MeridianInvocationCapabilities? = nil
    ) {
        self.admit = admit
        self.execute = execute
        self.images = images
        self.symbols = symbols
        self.rpcContext = rpcContext
        self.rpc = rpc
        self.capabilities = capabilities ?? .init()
    }

    public func image(for uri: String) -> Image? { images[Data(uri.utf8)] }
    public func symbol(for key: String) -> String? { symbols[Data(key.utf8)] }

    public func request(_ call: Meridian_Ui_V1_RpcCall, context: Meridian_Ui_V1_RequestContext,
                        tier: MeridianRpcTier = .read) async throws -> Google_Protobuf_Value {
        try Task.checkCancellation()
        guard !call.service.isEmpty, !call.method.isEmpty else { throw MeridianRpcError.invalidCall }
        let request: Google_Protobuf_Value
        do { request = try MeridianCore.buildRequest(call, context: context) }
        catch { throw MeridianRpcError.invalidRequest }
        guard let rpc else { throw MeridianRpcError.unavailable }
        let admission = tier == .mutation ? rpc.admitMutation(call, request) : rpc.admit(call, request)
        guard case .allow = admission, self.rpc === rpc else { throw MeridianRpcError.denied }
        if tier == .mutation {
            guard try context.serializedData() == rpcContext.serializedData() else {
                throw MeridianRpcError.denied
            }
        }
        try Task.checkCancellation()
        do {
            let result = try await rpc.invoke(call, request)
            try Task.checkCancellation()
            return result
        } catch is CancellationError { throw CancellationError() }
        catch { throw MeridianRpcError.failed } // Never echo transport errors or payloads.
    }

    public func activate(_ request: MeridianActivation) async {
        guard !pending else { return }
        // Normalize the legacy runtime copy request before the one typed
        // dispatcher. Retain its policy envelope during the compatibility window.
        let action: Meridian_Ui_V1_Affordance
        switch request {
        case .affordance(let authored): action = authored
        case .copy(let value):
            var normalized = Meridian_Ui_V1_Affordance()
            normalized.copy = value
            action = normalized
        }
        let valid: Bool
        switch action.invoke {
        case .uri(let value), .command(let value), .openView(let value): valid = !value.isEmpty
        case .navigate(let target): valid = !target.route.isEmpty
        case .rpc(let call): valid = !call.service.isEmpty && !call.method.isEmpty
        case .openPanel(let panel): valid = panel.body != nil
        case .copy: valid = true // Empty literal copy is an intentional operation.
        case nil:
            feedback = "This action has no supported target."
            return
        }
        guard valid else {
            feedback = "This action has no usable target."
            return
        }
        switch admit(request) {
        case .deny(let reason):
            feedback = reason.isEmpty ? "This action is not permitted." : reason
            return
        case .allow: break
        }
        let context = rpcContext
        if action.hasEnabledWhen {
            guard context.hasSelectedRow,
                  (try? MeridianCore.matchesRowFilter(action.enabledWhen, row: context.selectedRow)) == true else {
                feedback = "This action is not enabled for the current selection."
                return
            }
        }
        pending = true
        feedback = "Working…"
        defer { pending = false }
        do {
            try Task.checkCancellation()
            switch action.invoke {
            case .uri(let value):
                if let capability = capabilities.uri { try await capability(value, context) }
                else if let execute { try await execute(request) }
                else { throw MeridianRpcError.unavailable }
            case .command(let value):
                if let capability = capabilities.command { try await capability(value, context) }
                else if let execute { try await execute(request) }
                else { throw MeridianRpcError.unavailable }
            case .navigate(let target):
                guard let capability = capabilities.navigate else { throw MeridianRpcError.unavailable }
                try await capability(target, context)
            case .openPanel(let panel):
                guard let capability = capabilities.openPanel else { throw MeridianRpcError.unavailable }
                try await capability(panel, context)
            case .openView(let id):
                guard let capability = capabilities.openView else { throw MeridianRpcError.unavailable }
                try await capability(id, context)
            case .copy(let value):
                if let capability = capabilities.copy { try await capability(value, context) }
                else if case .copy = request, let execute { try await execute(request) }
                else { throw MeridianRpcError.unavailable }
            case .rpc(let call):
                _ = try await self.request(call, context: context, tier: .mutation)
            case nil:
                feedback = "This action has no supported target."
                return
            }
            try Task.checkCancellation()
            feedback = "Completed."
        } catch MeridianRpcError.unavailable {
            feedback = "This host has not installed the required capability."
        } catch MeridianRpcError.denied {
            feedback = "This action request is not permitted."
        } catch is CancellationError {
            feedback = "Canceled."
        } catch {
            // Errors and request descriptions may contain secrets. Do not echo.
            feedback = "The action failed. Try again."
        }
    }
}
