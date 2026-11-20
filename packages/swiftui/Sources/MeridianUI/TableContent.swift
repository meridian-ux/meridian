import SwiftUI

/// Read-only native table. The host owns admission and transport for the
/// populate call, and the shared core owns path resolution and formatting.
struct TablePanelContent: View {
    let panel: Meridian_Ui_V1_TablePanel
    @ObservedObject var host: MeridianHost
    @State private var loaded: Loaded?
    @State private var page = 0
    @State private var attempt = 0

    private struct Request: Equatable {
        let identity: NativeReadIdentity
        let attempt: Int
    }

    private struct Loaded {
        let request: Request
        let rows: [[String]]?
        let message: String?
    }

    private var pageSize: Int {
        panel.pagination.pageSize == 0 ? 25 : Int(panel.pagination.pageSize)
    }

    private var canLoad: Bool {
        panel.hasPopulate && !panel.columns.isEmpty &&
            (panel.pagination.mode == .unspecified || panel.pagination.mode == .client)
    }

    var body: some View {
        let request = (try? NativeReadIdentity(panel: panel, host: host)).map {
            Request(identity: $0, attempt: attempt)
        }
        let current = loaded?.request == request ? loaded : nil
        return VStack(alignment: .leading, spacing: 10) {
            if !panel.columns.isEmpty {
                table(rows: current?.rows ?? [])
            }
            if panel.columns.isEmpty {
                Text("This table has no columns.")
            } else if !panel.hasPopulate || request == nil {
                Text("This table has no usable data source.")
            } else if !canLoad {
                Text("This table requires server pagination, which SwiftUI does not support yet.")
            } else if let message = current?.message {
                Text(message).foregroundStyle(.secondary)
                Button("Retry table") { attempt += 1 }
            } else if let rows = current?.rows {
                if rows.isEmpty {
                    Text(panel.placeholder.isEmpty ? "No rows." : panel.placeholder)
                        .foregroundStyle(.secondary)
                } else {
                    pageControls(count: rows.count)
                }
            } else {
                Text("Loading table…").foregroundStyle(.secondary)
            }
        }
        .task(id: request) {
            guard let request, canLoad else { return }
            let result: Loaded
            do {
                let response = try await host.request(panel.populate, context: host.rpcContext)
                let rows = try MeridianCore.renderTable(panel, response: response)
                result = Loaded(request: request, rows: rows, message: nil)
            } catch is CancellationError {
                return
            } catch {
                let message: String
                switch error {
                case MeridianRpcError.unavailable: message = "This host has no table data capability."
                case MeridianRpcError.denied: message = "This table request is not permitted."
                default: message = "Table data could not be loaded."
                }
                result = Loaded(request: request, rows: nil, message: message)
            }
            guard !Task.isCancelled else { return }
            page = 0
            loaded = result
        }
    }

    private func table(rows: [[String]]) -> some View {
        ScrollView([.horizontal, .vertical]) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(Array(panel.columns.enumerated()), id: \.offset) { _, column in
                        Text(column.header)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(1)
                            .accessibilityAddTraits(.isHeader)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .frame(minWidth: 90, maxWidth: 240, alignment: .leading)
                    }
                }
                .background(.quaternary)
                let start = min(page * pageSize, rows.count)
                ForEach(Array(rows.dropFirst(start).prefix(pageSize).enumerated()), id: \.offset) { index, row in
                    GridRow {
                        ForEach(Array(row.enumerated()), id: \.offset) { column, value in
                            Text(value)
                                .lineLimit(1)
                                .truncationMode(.tail)
                                .textSelection(.enabled)
                                .accessibilityLabel(panel.columns[column].header + ": " + value)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .frame(minWidth: 90, maxWidth: 240, alignment: .leading)
                        }
                    }
                    .background(index.isMultiple(of: 2) ? Color.clear : Color.primary.opacity(0.05))
                }
            }
        }
        .frame(maxHeight: rows.isEmpty ? 38 : min(360, CGFloat(min(rows.count, pageSize) + 1) * 38))
        .accessibilityLabel("Table")
    }

    private func pageControls(count: Int) -> some View {
        let lastPage = (count - 1) / pageSize
        return HStack {
            Text("\(count) " + (panel.itemNoun.isEmpty ? (count == 1 ? "row" : "rows") : panel.itemNoun))
                .foregroundStyle(.secondary)
            if lastPage > 0 {
                Button("Previous page") { page -= 1 }.disabled(page == 0)
                Text("Page \(page + 1) of \(lastPage + 1)")
                Button("Next page") { page += 1 }.disabled(page >= lastPage)
            }
        }
        .font(.caption)
    }
}
