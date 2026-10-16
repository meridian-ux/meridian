import SwiftProtobuf
import SwiftUI

/// Runtime identity, not a serialized artifact. Deterministic protobuf bytes
/// avoid both dictionary-order churn and String canonical-equivalence aliases.
struct NativeStatIdentity: Equatable {
    let panel: Data
    let context: Data
    let host: UUID
    let capability: UUID?

    @MainActor
    init(panel: Meridian_Ui_V1_StatPanel, host: MeridianHost) throws {
        var options = BinaryEncodingOptions()
        options.useDeterministicOrdering = true
        self.panel = try panel.serializedData(options: options)
        context = try host.rpcContext.serializedData(options: options)
        self.host = host.identity
        capability = host.rpc?.identity
    }
}

@MainActor
final class NativeStatState: ObservableObject {
    @Published private(set) var key: NativeStatIdentity?
    @Published private(set) var response: Google_Protobuf_Value?
    @Published private(set) var pending = false
    @Published private(set) var message = ""
    private var generation: UInt64 = 0
    private var worker: Task<Void, Never>?

    func cancel() {
        generation &+= 1
        worker?.cancel()
        worker = nil
        key = nil
        response = nil
        pending = false
        message = ""
    }

    func load(panel: Meridian_Ui_V1_StatPanel, host: MeridianHost, key requested: NativeStatIdentity) async {
        guard panel.hasPopulate else { cancel(); return }
        guard (try? NativeStatIdentity(panel: panel, host: host)) == requested else { return }
        if pending && key == requested { return }
        cancel()
        key = requested
        pending = true
        let current = generation
        let context = host.rpcContext
        let task = Task { @MainActor in
            defer {
                if self.generation == current {
                    self.pending = false
                    self.worker = nil
                }
            }
            do {
                let result = try await host.request(panel.populate, context: context)
                guard case .structValue = result.kind else { throw MeridianRpcError.invalidResponse }
                // Validate bounds and dynamic values before retaining a response.
                _ = try MeridianCore.computeStat(panel, response: result)
                guard !Task.isCancelled, self.generation == current else { return }
                self.response = result
                self.message = ""
            } catch {
                guard self.generation == current else { return }
                switch error {
                case is CancellationError: self.message = "Metric loading canceled."
                case MeridianRpcError.denied: self.message = "This metric request is not permitted."
                case MeridianRpcError.unavailable: self.message = "This host has no metric data capability."
                case MeridianRpcError.invalidCall: self.message = "This metric has no usable data source."
                default: self.message = "Metric data could not be loaded. Try again."
                }
            }
        }
        worker = task
        await withTaskCancellationHandler(operation: { await task.value }, onCancel: { task.cancel() })
    }
}

struct StatPanelContent: View {
    let panel: Meridian_Ui_V1_StatPanel
    @ObservedObject var host: MeridianHost
    @StateObject private var state = NativeStatState()
    var body: some View { StatContent(panel: panel, host: host, state: state) }
}

struct StatContent: View {
    let panel: Meridian_Ui_V1_StatPanel
    @ObservedObject var host: MeridianHost
    @ObservedObject var state: NativeStatState
    @Environment(\.meridianTheme) private var theme
    @Environment(\.colorScheme) private var scheme

    static func direction(_ trend: Meridian_Ui_V1_Trend) -> String {
        switch trend { case .up: "Increasing"; case .down: "Decreasing"; case .flat: "Unchanged"; default: "" }
    }

    var body: some View {
        let key = try? NativeStatIdentity(panel: panel, host: host)
        let matches = key != nil && state.key == key
        let computed = try? MeridianCore.computeStat(panel, response: matches ? state.response : nil)
        let palette = MeridianSurface.palette(theme, dark: scheme == .dark)
        return VStack(alignment: .leading, spacing: 8) {
            Text(panel.label.isEmpty ? "Metric" : panel.label).font(.headline).accessibilityAddTraits(.isHeader)
            Text(computed?.formattedValue ?? "Metric could not be formatted.").font(.title).textSelection(.enabled)
            if let computed {
                let direction = Self.direction(computed.trend)
                if !direction.isEmpty || computed.hasFormattedDelta {
                    Text([direction, computed.hasFormattedDelta ? computed.formattedDelta : ""]
                        .filter { !$0.isEmpty }.joined(separator: ": "))
                        .foregroundStyle(MeridianSurface.color(computed.tone == .success ? palette?.success : computed.tone == .danger ? palette?.danger : nil) ?? .primary)
                }
                if computed.tone == .success { Text("Favorable change").font(.caption) }
                if computed.tone == .danger { Text("Unfavorable change").font(.caption) }
                if !computed.series.isEmpty {
                    if computed.series.allSatisfy(\.isFinite) {
                        NativeSparkline(series: computed.series).stroke(.primary, lineWidth: 1.5).frame(height: 40)
                            .accessibilityLabel("Metric history: \(computed.series.count) observations")
                    } else { Text("Metric history contains unavailable values.") }
                    Text("History: \(computed.series.count) observations").font(.caption)
                }
            }
            if !panel.caption.isEmpty { Text(panel.caption).foregroundStyle(.secondary) }
            if panel.hasPopulate {
                if key == nil { Text("Metric request could not be prepared.") }
                else if !matches || state.pending { Text("Loading metric…") }
                else if !state.message.isEmpty { Text(state.message) }
                Button(matches && !state.message.isEmpty ? "Retry metric" : "Refresh metric") {
                    if let key { Task { await state.load(panel: panel, host: host, key: key) } }
                }.disabled(key == nil || (matches && state.pending))
            }
        }
        .task(id: key) {
            if let key, panel.hasPopulate { await state.load(panel: panel, host: host, key: key) }
            else { state.cancel() }
        }
        .onDisappear { state.cancel() }
    }
}

/// Geometry only: never formats values or computes semantic trend/tone.
struct NativeSparkline: Shape {
    let series: [Double]
    func path(in rect: CGRect) -> Path {
        let points = Self.points(series, in: rect)
        return Path { path in
            if let first = points.first {
                path.move(to: first)
                for point in points.dropFirst() { path.addLine(to: point) }
            }
        }
    }

    static func points(_ series: [Double], in rect: CGRect) -> [CGPoint] {
        guard series.count >= 2, series.allSatisfy(\.isFinite), rect.width.isFinite, rect.height.isFinite,
              rect.minX.isFinite, rect.minY.isFinite,
              rect.maxX.isFinite, rect.maxY.isFinite,
              rect.width >= 0, rect.height >= 0 else { return [] }
        let scale = series.map { abs($0) }.max() ?? 0
        let normalized = series.map { scale == 0 ? 0 : $0 / scale }
        let low = normalized.min()!, high = normalized.max()!
        let count = min(series.count, 256)
        return (0..<count).map { sample in
            let index = Int(Double(sample) * Double(series.count - 1) / Double(count - 1))
            let y = high == low ? 0.5 : 1 - (normalized[index] - low) / (high - low)
            return CGPoint(x: rect.minX + Double(index) / Double(series.count - 1) * rect.width,
                           y: rect.minY + y * rect.height)
        }
    }
}
