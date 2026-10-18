import MeridianProtos

/// In-process host capabilities, never descriptor-authored grants or DTOs.
/// Each installed operation still requires the host's current admission policy.
/// Missing operations deny; the renderer installs no URL, shell, or clipboard IO.
@MainActor
public struct MeridianInvocationCapabilities {
    public var uri: ((String, Meridian_Ui_V1_RequestContext) async throws -> Void)?
    public var command: ((String, Meridian_Ui_V1_RequestContext) async throws -> Void)?
    public var navigate: ((Meridian_Ui_V1_Navigate, Meridian_Ui_V1_RequestContext) async throws -> Void)?
    public var openPanel: ((Meridian_Ui_V1_PanelDescriptor, Meridian_Ui_V1_RequestContext) async throws -> Void)?
    public var openView: ((String, Meridian_Ui_V1_RequestContext) async throws -> Void)?
    public var copy: ((String, Meridian_Ui_V1_RequestContext) async throws -> Void)?

    public init() {}
}

public enum MeridianRpcTier: Equatable, Sendable {
    case read, mutation
}
