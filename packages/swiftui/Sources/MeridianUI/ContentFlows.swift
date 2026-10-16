import Foundation
import MeridianProtos
import SwiftUI

// Runtime selection identity is exact UTF-8, not Swift String's canonical
// equivalence. Invalid/duplicate identifiers disable a choice, not its host.
enum NativeSelection {
    static func identifiers(_ strings: [String]) -> [Data]? {
        let ids = strings.map { Data($0.utf8) }
        return ids.allSatisfy { !$0.isEmpty } && Set(ids).count == ids.count ? ids : nil
    }

    static func resolve(_ ids: [Data], preferred: String, remembered: Data?) -> Data? {
        if let remembered, ids.contains(remembered) { return remembered }
        let preferred = Data(preferred.utf8)
        return ids.first(where: { $0 == preferred }) ?? ids.first
    }
}

@MainActor
final class NativeSelectionState: ObservableObject {
    @Published var remembered: Data?
}

// State lifetime belongs to SwiftUI; the content receives an ordinary observed
// model so selection behavior can be exercised without production test hooks.
struct ConnectFlowPanelContent: View {
    let panel: Meridian_Ui_V1_ConnectFlowPanel
    @ObservedObject var host: MeridianHost
    @StateObject private var selection = NativeSelectionState()
    var body: some View { ConnectFlowContent(panel: panel, host: host, selection: selection) }
}

struct ConnectFlowContent: View {
    let panel: Meridian_Ui_V1_ConnectFlowPanel
    @ObservedObject var host: MeridianHost
    @ObservedObject var selection: NativeSelectionState

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !panel.prompt.isEmpty { Text(panel.prompt) }
            if panel.hasEndpoint { CopyValueContent(value: panel.endpoint, host: host) }
            if panel.targets.isEmpty {
                Text(panel.placeholder.isEmpty ? "No connection targets." : panel.placeholder)
            } else if let ids = NativeSelection.identifiers(panel.targets.map(\.id)) {
                let binding = Binding<Data?>(
                    get: { NativeSelection.resolve(ids, preferred: panel.defaultTargetID, remembered: selection.remembered) },
                    set: { selection.remembered = $0 })
                Picker("Choose a connection target", selection: binding) {
                    ForEach(Array(panel.targets.enumerated()), id: \.offset) { _, target in
                        Text(target.label.isEmpty ? "Unnamed target" : target.label)
                            .tag(Optional(Data(target.id.utf8)))
                    }
                }
                if let target = panel.targets.first(where: { Data($0.id.utf8) == binding.wrappedValue }) {
                    VStack(alignment: .leading, spacing: 8) {
                        if !target.name.isEmpty { Text(target.name).font(.headline).accessibilityAddTraits(.isHeader) }
                        if !target.description_p.isEmpty { Text(target.description_p) }
                        if let symbol = host.symbol(for: target.icon), !symbol.isEmpty {
                            Image(systemName: symbol).accessibilityHidden(true)
                        }
                        ForEach(Array(target.actions.enumerated()), id: \.offset) { _, action in
                            AffordanceContent(action: action, host: host)
                        }
                        ForEach(Array(target.configs.enumerated()), id: \.offset) { _, snippet in
                            SnippetContent(snippet: snippet, host: host)
                        }
                    }
                    .id(Data(target.id.utf8))
                }
            } else {
                Text("Connection targets need nonempty, unique IDs.")
            }
        }
    }
}

struct StepsContent: View {
    let panel: Meridian_Ui_V1_StepsPanel
    @ObservedObject var host: MeridianHost

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !panel.intro.isEmpty { Text(panel.intro) }
            if panel.steps.isEmpty { Text("No steps.") }
            ForEach(Array(panel.steps.enumerated()), id: \.offset) { index, step in
                VStack(alignment: .leading, spacing: 8) {
                    Text("\(index + 1). \(step.label)").font(.headline).accessibilityAddTraits(.isHeader)
                    if !step.detail.isEmpty { Text(step.detail) }
                    if !step.actor.isEmpty {
                        Label(step.actor, systemImage: "person.crop.circle").font(.caption)
                            .accessibilityLabel("Actor: \(step.actor)")
                    }
                    if !step.mediaUri.isEmpty || !step.mediaAlt.isEmpty {
                        if let image = host.image(for: step.mediaUri) {
                            image.resizable().scaledToFit().frame(maxHeight: 240)
                                .accessibilityLabel(step.mediaAlt.isEmpty ? "Step illustration" : step.mediaAlt)
                        } else {
                            Label(step.mediaAlt.isEmpty ? "Illustration unavailable." : step.mediaAlt, systemImage: "photo")
                        }
                    }
                    if step.hasAction { AffordanceContent(action: step.action, host: host) }
                }
            }
            if !panel.outro.isEmpty { Text(panel.outro) }
        }
    }
}
