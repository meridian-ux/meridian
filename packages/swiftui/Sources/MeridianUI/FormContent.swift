import SwiftUI

enum NativeFormValues {
    typealias Value = Google_Protobuf_Value
    typealias Field = Meridian_Ui_V1_FormField
    typealias Repeated = Meridian_Ui_V1_RepeatedField

    enum InvalidForm: Error { case descriptor }

    static func initial(_ fields: [Field], prefill: Value = .init()) throws -> Value {
        var budget = 1_000
        try check(fields, depth: 0, budget: &budget)
        budget = 1_000
        return try object(fields, prefill: prefill, budget: &budget)
    }

    private static func check(_ fields: [Field], depth: Int, budget: inout Int) throws {
        guard depth <= 32, fields.count <= budget,
              Set(fields.map(\.fieldID)).count == fields.count,
              fields.allSatisfy({ !$0.fieldID.isEmpty }) else { throw InvalidForm.descriptor }
        for field in fields {
            try check(field, depth: depth, budget: &budget)
        }
    }

    private static func check(_ field: Field, depth: Int, budget: inout Int) throws {
        guard depth <= 32, budget > 0 else { throw InvalidForm.descriptor }
        budget -= 1
        switch field.kind {
        case .nested(let nested): try check(nested.fields, depth: depth + 1, budget: &budget)
        case .repeated(let repeated):
            guard repeated.minItems <= 100,
                  repeated.maxItems == 0 || repeated.minItems <= repeated.maxItems else { throw InvalidForm.descriptor }
            switch repeated.element {
            case .scalar(let scalar): try check(scalar, depth: depth + 1, budget: &budget)
            case .object(let nested): try check(nested.fields, depth: depth + 1, budget: &budget)
            case nil: throw InvalidForm.descriptor
            }
        case .enumSelection(let spec):
            guard !spec.hasOptionsSource, !choices(spec).isEmpty else { throw InvalidForm.descriptor }
        case nil: throw InvalidForm.descriptor
        default: break
        }
    }

    static func object(_ fields: [Field], prefill: Value, budget: inout Int) throws -> Value {
        var result = Value()
        for field in fields {
            result.structValue.fields[field.fieldID] = try initial(
                field, supplied: prefill.structValue.fields[field.fieldID] ?? .init(), budget: &budget
            )
        }
        if fields.isEmpty { result.structValue = .init() }
        return result
    }

    static func item(_ spec: Repeated) throws -> Value {
        var budget = 1_000
        return try item(spec, supplied: .init(), budget: &budget)
    }

    private static func item(_ spec: Repeated, supplied: Value, budget: inout Int) throws -> Value {
        guard budget > 0 else { throw InvalidForm.descriptor }
        budget -= 1
        switch spec.element {
        case .scalar(let field): return try initial(field, supplied: supplied, budget: &budget)
        case .object(let nested): return try object(nested.fields, prefill: supplied, budget: &budget)
        case nil: throw InvalidForm.descriptor
        }
    }

    private static func initial(_ field: Field, supplied: Value, budget: inout Int) throws -> Value {
        guard budget > 0 else { throw InvalidForm.descriptor }
        budget -= 1
        var result = Value()
        switch field.kind {
        case .text(let spec): result.stringValue = string(supplied) ?? spec.defaultValue
        case .masked(let spec): result.stringValue = string(supplied) ?? spec.defaultValue
        case .integer(let spec):
            if case .numberValue = supplied.kind { return supplied }
            result.numberValue = Double(spec.defaultValue)
        case .number(let spec):
            if case .numberValue = supplied.kind { return supplied }
            result.numberValue = spec.defaultValue
        case .boolean(let spec):
            if case .boolValue = supplied.kind { return supplied }
            result.boolValue = spec.defaultValue
        case .enumSelection(let spec):
            let options = choices(spec)
            let preferred = string(supplied) ?? spec.defaultValue
            result.stringValue = options.first { $0.value.utf8.elementsEqual(preferred.utf8) }?.value
                ?? options.first?.value ?? ""
        case .nested(let spec): return try object(spec.fields, prefill: supplied, budget: &budget)
        case .repeated(let spec):
            let values = supplied.listValue.values
            guard values.count <= limit(spec.maxItems) else { throw InvalidForm.descriptor }
            result.listValue.values = try (0..<max(values.count, Int(spec.minItems))).map { index in
                let value = index < values.count ? values[index] : Value()
                return try item(spec, supplied: value, budget: &budget)
            }
        case .keyValueMap(let spec):
            let entries = supplied.structValue.fields
            guard entries.count <= limit(spec.maxItems), entries.count <= budget else { throw InvalidForm.descriptor }
            budget -= entries.count
            result.listValue.values = entries.keys.sorted().compactMap { key in
                guard let value = entries[key], string(value) != nil else { return nil }
                var entry = Value()
                entry.structValue.fields = ["key": Value(stringLiteral: key), "value": value]
                return entry
            }
        case nil: throw InvalidForm.descriptor
        }
        return result
    }

    static func submission(_ fields: [Field], values: Value) -> Value {
        var result = Value()
        result.structValue.fields = Dictionary(uniqueKeysWithValues: fields.map { field in
            (field.fieldID, submission(field, value: values.structValue.fields[field.fieldID] ?? .init()))
        })
        return result
    }

    private static func submission(_ field: Field, value: Value) -> Value {
        var result = Value()
        switch field.kind {
        case .integer, .number:
            if let text = string(value), let number = Double(text.trimmingCharacters(in: .whitespaces)), number.isFinite {
                result.numberValue = number
                return result
            }
        case .nested(let nested): return submission(nested.fields, values: value)
        case .repeated(let repeated):
            result.listValue.values = value.listValue.values.map { item in
                switch repeated.element {
                case .scalar(let scalar): return submission(scalar, value: item)
                case .object(let nested): return submission(nested.fields, values: item)
                case nil: return item
                }
            }
            return result
        case .keyValueMap:
            var fields: [String: Value] = [:]
            for entry in value.listValue.values {
                let key = entry.structValue.fields["key"]?.stringValue ?? ""
                guard !key.isEmpty, fields[key] == nil else { return result }
                fields[key] = entry.structValue.fields["value"] ?? Value(stringLiteral: "")
            }
            result.structValue.fields = fields
            return result
        default: break
        }
        return value
    }

    static func limit(_ maximum: UInt32) -> Int { maximum == 0 ? 100 : min(100, Int(maximum)) }

    static func string(_ value: Value) -> String? {
        if case .stringValue(let text) = value.kind { return text }
        return nil
    }

    static func choices(_ spec: Meridian_Ui_V1_EnumSelection) -> [Meridian_Ui_V1_EnumOption] {
        spec.options.isEmpty ? spec.allowedValues.map { value in
            var option = Meridian_Ui_V1_EnumOption()
            option.value = value
            return option
        } : spec.options
    }
}

struct FormPanelContent: View {
    let panel: Meridian_Ui_V1_FormPanel
    @ObservedObject var host: MeridianHost

    var body: some View {
        if let key = try? NativeReadIdentity(panel: panel, host: host),
           let values = try? NativeFormValues.initial(panel.fields) {
            NativeFormSession(panel: panel, host: host, values: values).id(key)
        } else {
            Text("This form has unsupported or invalid fields.")
        }
    }
}

private struct NativeFormSession: View {
    let panel: Meridian_Ui_V1_FormPanel
    @ObservedObject var host: MeridianHost
    @State var values: Google_Protobuf_Value
    @State private var prefillComplete = false
    @State private var prefillFailed = false

    private var editable: Bool { panel.mode == .edit }
    private var loading: Bool { editable && panel.hasPrefill && !prefillComplete }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if loading {
                Text("Loading form…")
            } else {
                if prefillFailed {
                    Text("Initial values could not be loaded. Showing defaults.").foregroundStyle(.secondary)
                }
                ScrollView {
                    NativeFormFields(fields: panel.fields, value: $values, editable: editable)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .disabled(host.pending)
                }
                .frame(maxHeight: 340)
                if editable, case .rpc = panel.submitAffordance.invoke {
                    Button(panel.submitAffordance.label.isEmpty ? "Save" : panel.submitAffordance.label) {
                        guard let key = try? NativeReadIdentity(panel: panel, host: host) else { return }
                        let submitted = NativeFormValues.submission(panel.fields, values: values)
                        Task {
                            guard (try? NativeReadIdentity(panel: panel, host: host)) == key else { return }
                            await host.submit(panel, values: submitted)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(host.pending)
                }
            }
        }
        .frame(maxWidth: 460, alignment: .leading)
        .task {
            guard loading else { return }
            do {
                let response = try await host.request(panel.prefill, context: host.rpcContext)
                guard case .structValue = response.kind else { throw MeridianRpcError.invalidResponse }
                let initial = try NativeFormValues.initial(panel.fields, prefill: response)
                guard !Task.isCancelled else { return }
                values = initial
            } catch is CancellationError { return }
            catch { prefillFailed = true }
            prefillComplete = true
        }
    }
}

private struct NativeFormFields: View {
    let fields: [NativeFormValues.Field]
    @Binding var value: Google_Protobuf_Value
    let editable: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(fields.enumerated()), id: \.offset) { _, field in
                NativeFormField(field: field, value: Binding(
                    get: { value.structValue.fields[field.fieldID] ?? .init() },
                    set: { value.structValue.fields[field.fieldID] = $0 }
                ), editable: editable)
            }
        }
    }
}

private struct NativeFormField: View {
    let field: NativeFormValues.Field
    @Binding var value: Google_Protobuf_Value
    let editable: Bool

    private var label: String { field.label.isEmpty ? field.fieldID : field.label }

    private var text: Binding<String> {
        Binding(get: {
            if case .numberValue(let number) = value.kind { return String(number) }
            return value.stringValue
        }, set: { value.stringValue = $0 })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !label.isEmpty { Text(label).font(.subheadline.weight(.semibold)) }
            switch field.kind {
            case .nested(let nested):
                NativeFormFields(fields: nested.fields, value: $value, editable: editable).padding(.leading, 12)
            case .repeated(let repeated):
                NativeRepeatedField(spec: repeated, value: $value, editable: editable)
            case .keyValueMap(let map):
                NativeMapField(spec: map, value: $value, editable: editable)
            default:
                if editable { input }
                else { Text(displayText).foregroundStyle(.secondary).textSelection(.enabled) }
            }
            if !field.description_p.isEmpty { Text(field.description_p).font(.caption).foregroundStyle(.secondary) }
        }
    }

    private var displayText: String {
        if case .masked = field.kind { return value.stringValue.isEmpty ? "—" : "••••••••" }
        if field.hasDisplay, let formatted = try? MeridianCore.format(value, display: field.display) { return formatted.text }
        if case .boolean = field.kind { return value.boolValue ? "Yes" : "No" }
        if case .enumSelection(let spec) = field.kind,
           let option = NativeFormValues.choices(spec).first(where: { $0.value.utf8.elementsEqual(value.stringValue.utf8) }),
           !option.label.isEmpty { return option.label }
        return text.wrappedValue.isEmpty ? "—" : text.wrappedValue
    }

    @ViewBuilder private var input: some View {
        let accessibleLabel = label.isEmpty ? "Value" : label
        switch field.kind {
        case .masked:
            SecureField(accessibleLabel, text: text).textFieldStyle(.roundedBorder)
        case .boolean:
            Toggle(accessibleLabel, isOn: Binding(get: { value.boolValue }, set: { value.boolValue = $0 }))
        case .enumSelection(let spec):
            let choices = NativeFormValues.choices(spec)
            Picker(accessibleLabel, selection: Binding<Data>(
                get: { Data(value.stringValue.utf8) },
                set: { value.stringValue = String(decoding: $0, as: UTF8.self) }
            )) {
                ForEach(Array(choices.enumerated()), id: \.offset) { _, option in
                    Text(option.label.isEmpty ? option.value : option.label).tag(Data(option.value.utf8))
                }
            }.labelsHidden()
        default:
            TextField(accessibleLabel, text: text).textFieldStyle(.roundedBorder)
        }
    }
}

struct NativeRepeatedField: View {
    let spec: NativeFormValues.Repeated
    @Binding var value: Google_Protobuf_Value
    let editable: Bool

    var body: some View {
        let count = value.listValue.values.count
        VStack(alignment: .leading, spacing: 8) {
            if count == 0 { Text("No items yet.").font(.caption).foregroundStyle(.secondary) }
            ForEach(0..<count, id: \.self) { index in
                VStack(alignment: .leading, spacing: 8) {
                    let item = Binding<Google_Protobuf_Value>(
                        get: { value.listValue.values.indices.contains(index) ? value.listValue.values[index] : .init() },
                        set: { if value.listValue.values.indices.contains(index) { value.listValue.values[index] = $0 } }
                    )
                    switch spec.element {
                    case .scalar(let field): NativeFormField(field: field, value: item, editable: editable)
                    case .object(let nested): NativeFormFields(fields: nested.fields, value: item, editable: editable)
                    case nil: EmptyView()
                    }
                    if editable {
                        Button("Remove item") {
                            if value.listValue.values.count > Int(spec.minItems), value.listValue.values.indices.contains(index) {
                                value.listValue.values.remove(at: index)
                            }
                        }
                        .accessibilityLabel("Remove item \(index + 1)")
                        .disabled(count <= Int(spec.minItems))
                    }
                }
                .padding(10)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 6))
            }
            if editable {
                Button(spec.addLabel.isEmpty ? "Add item" : spec.addLabel) {
                    if value.listValue.values.count < NativeFormValues.limit(spec.maxItems),
                       let item = try? NativeFormValues.item(spec) {
                        value.listValue.values.append(item)
                    }
                }
                .disabled(count >= NativeFormValues.limit(spec.maxItems))
            }
        }
    }
}

private struct NativeMapField: View {
    let spec: Meridian_Ui_V1_KeyValueMapField
    @Binding var value: Google_Protobuf_Value
    let editable: Bool

    var body: some View {
        let entries = value.listValue.values
        VStack(alignment: .leading, spacing: 8) {
            if entries.isEmpty { Text("No entries yet.").font(.caption).foregroundStyle(.secondary) }
            ForEach(entries.indices, id: \.self) { index in
                if editable {
                    HStack {
                        TextField(spec.keyLabel.isEmpty ? "Key" : spec.keyLabel, text: input("key", at: index))
                        TextField(spec.valueLabel.isEmpty ? "Value" : spec.valueLabel, text: input("value", at: index))
                        Button("Remove entry") {
                            if value.listValue.values.indices.contains(index) { value.listValue.values.remove(at: index) }
                        }
                    }.textFieldStyle(.roundedBorder)
                } else {
                    LabeledContent(input("key", at: index).wrappedValue, value: input("value", at: index).wrappedValue)
                }
            }
            if editable {
                Button(spec.addLabel.isEmpty ? "Add entry" : spec.addLabel) {
                    if value.listValue.values.count < NativeFormValues.limit(spec.maxItems) {
                        value.listValue.values.append(.init())
                    }
                }
                .disabled(entries.count >= NativeFormValues.limit(spec.maxItems))
            }
        }
    }

    private func input(_ field: String, at index: Int) -> Binding<String> {
        Binding(get: {
            guard value.listValue.values.indices.contains(index) else { return "" }
            return value.listValue.values[index].structValue.fields[field]?.stringValue ?? ""
        }, set: { text in
            guard value.listValue.values.indices.contains(index) else { return }
            value.listValue.values[index].structValue.fields[field] = Google_Protobuf_Value(stringLiteral: text)
        })
    }
}
