@_exported import MeridianProtos
import SwiftUI

/// Native renderer entry point. Unsupported shapes stay visible and never execute.
public struct MeridianPanel: View {
    public let descriptor: Meridian_Ui_V1_PanelDescriptor
    @ObservedObject private var host: MeridianHost

    public init(_ descriptor: Meridian_Ui_V1_PanelDescriptor, host: MeridianHost) {
        self.descriptor = descriptor
        self.host = host
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !descriptor.title.isEmpty {
                Text(descriptor.title).font(.headline).accessibilityAddTraits(.isHeader)
            }
            switch descriptor.body {
            case .choice(let panel): ChoicePanelContent(panel: panel)
            case .snippet(let panel): SnippetContent(snippet: panel.snippet, host: host)
            case .copyValue(let panel): CopyValueContent(value: panel.value, host: host)
            case .connectFlow(let panel): ConnectFlowPanelContent(panel: panel, host: host)
            case .steps(let panel): StepsContent(panel: panel, host: host)
            case .action(let panel):
                Text(panel.description_p)
                AffordanceContent(action: panel.action, host: host)
            case .catalog(let panel):
                if panel.items.isEmpty { Text(panel.placeholder.isEmpty ? "No items." : panel.placeholder) }
                ForEach(Array(panel.items.enumerated()), id: \.offset) { _, item in
                    VStack(alignment: .leading) {
                        Text(item.name).font(.headline)
                        Text(item.description_p)
                        if !item.tag.isEmpty { Text(item.tag).font(.caption) }
                        if !item.state.isEmpty { Text(item.state).font(.caption) }
                        if item.hasAction { AffordanceContent(action: item.action, host: host) }
                    }
                }
            case nil:
                Text("This panel has no supported content. It may require a newer renderer.")
            default:
                Text("This panel is not supported by this SwiftUI preview yet.")
            }
            if !host.feedback.isEmpty {
                Text(host.feedback).accessibilityLabel("Action status: \(host.feedback)")
            }
        }
        .padding()
        .modifier(MeridianSurface())
    }
}

struct ChoicePanelContent: View {
    let panel: Meridian_Ui_V1_ChoicePanel
    @StateObject private var selection = NativeSelectionState()
    var body: some View { ChoiceContent(panel: panel, selection: selection) }
}

struct ChoiceContent: View {
    let panel: Meridian_Ui_V1_ChoicePanel
    @ObservedObject var selection: NativeSelectionState

    static func initialSelection(_ panel: Meridian_Ui_V1_ChoicePanel) -> String {
        guard let ids = NativeSelection.identifiers(panel.options.map(\.id)),
              let initial = NativeSelection.resolve(ids, preferred: panel.defaultOptionID, remembered: nil)
        else { return "" }
        return String(decoding: initial, as: UTF8.self)
    }

    var body: some View {
        VStack(alignment: .leading) {
            if panel.options.isEmpty {
                Text(panel.prompt.isEmpty ? "No options." : panel.prompt)
            } else if let ids = NativeSelection.identifiers(panel.options.map(\.id)) {
                let binding = Binding<Data?>(
                    get: { NativeSelection.resolve(ids, preferred: panel.defaultOptionID, remembered: selection.remembered) },
                    set: { selection.remembered = $0 })
                Picker(panel.prompt.isEmpty ? "Choose an option" : panel.prompt, selection: binding) {
                    ForEach(Array(panel.options.enumerated()), id: \.offset) { _, option in
                        Text(option.label.isEmpty ? "Unnamed option" : option.label).tag(Optional(Data(option.id.utf8)))
                    }
                }
                if let option = panel.options.first(where: { Data($0.id.utf8) == binding.wrappedValue }), !option.description_p.isEmpty {
                    Text(option.description_p).foregroundStyle(.secondary)
                }
            } else {
                Text("Options need nonempty, unique IDs.")
            }
        }
    }
}

struct SnippetContent: View {
    let snippet: Meridian_Ui_V1_Snippet
    @ObservedObject var host: MeridianHost
    var body: some View {
        VStack(alignment: .leading) {
            if !snippet.label.isEmpty { Text(snippet.label).font(.headline) }
            if !snippet.path.isEmpty { Text(snippet.path).font(.caption) }
            ScrollView(.horizontal) {
                Text(snippet.content).font(.system(.body, design: .monospaced)).textSelection(.enabled)
            }
            Button {
                Task { await host.activate(.copy(snippet.content)) }
            } label: { Label("Copy snippet", systemImage: "doc.on.doc") }
                .disabled(host.pending)
        }
    }
}

struct CopyValueContent: View {
    let value: Meridian_Ui_V1_CopyValue
    @ObservedObject var host: MeridianHost
    @State private var revealedRawValue: String?
    private var revealed: Bool { Self.revealApplies(current: value.value, revealed: revealedRawValue) }

    static func revealApplies(current: String, revealed: String?) -> Bool {
        // Key disclosure to exact raw bytes, not Swift's canonically equivalent
        // String equality. A changed secret is masked before onChange runs.
        revealed.map { $0.utf8.elementsEqual(current.utf8) } ?? false
    }

    static func formatted(_ value: Meridian_Ui_V1_CopyValue, revealed: Bool) throws -> Meridian_Ui_V1_FormattedValue {
        var literal = Meridian_Ui_V1_FormattedValue()
        if value.secret && !revealed {
            literal.text = "••••••••"
            return literal
        }
        // CopyValue's absence/unspecified rule is raw literal text, not core's
        // legacy inference. No coercion of a string into a number/boolean.
        guard value.hasDisplay, value.display.type != .unspecified else {
            literal.text = value.value
            return literal
        }
        var input = Google_Protobuf_Value()
        input.stringValue = value.value
        return try MeridianCore.format(input, display: value.display)
    }

    var body: some View {
        let formatted = try? Self.formatted(value, revealed: revealed)
        return VStack(alignment: .leading) {
            if !value.label.isEmpty { Text(value.label).font(.headline) }
            Text(formatted?.text ?? "Value could not be formatted.")
                .font(.system(.body, design: .monospaced))
                .accessibilityLabel(value.secret && !revealed ? "Hidden value" : (formatted?.text ?? "Value could not be formatted."))
                .help(formatted?.hasTitle == true ? (formatted?.title ?? "") : "")
            if value.secret {
                Button(revealed ? "Hide value" : "Reveal value") {
                    revealedRawValue = revealed ? nil : value.value
                }
            }
            Button {
                Task { await host.activate(.copy(value.value)) }
            } label: { Label("Copy value", systemImage: "doc.on.doc") }
                .disabled(host.pending)
            if !value.help.isEmpty { Text(value.help).foregroundStyle(.secondary) }
        }
        .onChange(of: value) { _ in revealedRawValue = nil }
    }
}

struct AffordanceContent: View {
    let action: Meridian_Ui_V1_Affordance
    @ObservedObject var host: MeridianHost
    var body: some View {
        VStack(alignment: .leading) {
            Button {
                Task { await host.activate(.affordance(action)) }
            } label: {
                if let symbol = host.symbol(for: action.icon), !symbol.isEmpty {
                    Label(action.label.isEmpty ? "Unnamed action" : action.label, systemImage: symbol)
                } else {
                    Text(action.label.isEmpty ? "Unnamed action" : action.label)
                }
            }.disabled(host.pending || action.invoke == nil)
            if !action.description_p.isEmpty { Text(action.description_p).foregroundStyle(.secondary) }
            if action.invoke == nil { Text("This action has no supported target.") }
        }
    }
}
