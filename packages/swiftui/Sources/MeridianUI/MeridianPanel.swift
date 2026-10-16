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
            case .choice(let panel): ChoiceContent(panel: panel)
            case .snippet(let panel): SnippetContent(snippet: panel.snippet, host: host)
            case .copyValue(let panel): CopyValueContent(value: panel.value, host: host)
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

struct ChoiceContent: View {
    let panel: Meridian_Ui_V1_ChoicePanel
    @State private var selection: String

    static func initialSelection(_ panel: Meridian_Ui_V1_ChoicePanel) -> String {
        panel.options.contains { $0.id == panel.defaultOptionID }
            ? panel.defaultOptionID : (panel.options.first?.id ?? "")
    }

    init(panel: Meridian_Ui_V1_ChoicePanel) {
        self.panel = panel
        _selection = State(initialValue: Self.initialSelection(panel))
    }

    var body: some View {
        VStack(alignment: .leading) {
            if panel.options.isEmpty {
                Text(panel.prompt.isEmpty ? "No options." : panel.prompt)
            } else {
                Picker(panel.prompt.isEmpty ? "Choose an option" : panel.prompt, selection: $selection) {
                    ForEach(Array(panel.options.enumerated()), id: \.offset) { _, option in
                        Text(option.label).tag(option.id)
                    }
                }
                if let option = panel.options.first(where: { $0.id == selection }), !option.description_p.isEmpty {
                    Text(option.description_p).foregroundStyle(.secondary)
                }
            }
        }
        .onChange(of: panel) { updated in selection = Self.initialSelection(updated) }
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
    @State private var revealed = false
    var body: some View {
        VStack(alignment: .leading) {
            if !value.label.isEmpty { Text(value.label).font(.headline) }
            Text(value.secret && !revealed ? "••••••••" : value.value)
                .font(.system(.body, design: .monospaced))
                .accessibilityLabel(value.secret && !revealed ? "Hidden value" : value.value)
            if value.secret {
                Button(revealed ? "Hide value" : "Reveal value") { revealed.toggle() }
            }
            Button {
                Task { await host.activate(.copy(value.value)) }
            } label: { Label("Copy value", systemImage: "doc.on.doc") }
                .disabled(host.pending)
            if !value.help.isEmpty { Text(value.help).foregroundStyle(.secondary) }
        }
        .onChange(of: value) { _ in revealed = false }
    }
}

struct AffordanceContent: View {
    let action: Meridian_Ui_V1_Affordance
    @ObservedObject var host: MeridianHost
    var body: some View {
        VStack(alignment: .leading) {
            Button(action.label.isEmpty ? "Unnamed action" : action.label) {
                Task { await host.activate(.affordance(action)) }
            }.disabled(host.pending || action.invoke == nil)
            if !action.description_p.isEmpty { Text(action.description_p).foregroundStyle(.secondary) }
            if action.invoke == nil { Text("This action has no supported target.") }
        }
    }
}
