// Hand-written TypeScript types mirroring the proto3 JSON shape of
// meridian.ui.v1.PanelDescriptor. The wasm core (meridian-uiview)
// accepts these as JsValue and deserializes through prost+serde, so
// the field names are snake_case to match proto3 JSON conventions.
//
// We don't generate these from the proto today — they're a small,
// stable surface and hand-writing avoids pulling in a TS proto
// codegen. When a non-table panel-handling host grows, generating
// from the proto via @bufbuild/protoplugin or buf is a natural
// follow-up.

export type ColumnFormat =
  | 0  // UNSPECIFIED
  | 1  // STRING
  | 2  // FLOAT_2DP
  | 3  // INTEGER
  | 4  // ENUM_NAME
  | 5  // STRING_LIST
  | 6; // TIMESTAMP

export type ContextSource =
  | 0  // UNSPECIFIED
  | 1  // CURRENT_RESOURCE_PATH
  | 2; // UI_IDENTITY

export interface FieldBinding {
  request_field: string;
  // Exactly one of context / row_field / form_field / literal / nested
  // is set, mirroring the proto oneof.
  context?: ContextSource;
  row_field?: string;
  form_field?: string;
  literal?: string;
  nested?: NestedBinding;
}

export interface NestedBinding {
  fields: FieldBinding[];
}

export interface RpcCall {
  service: string;
  method: string;
  bindings?: FieldBinding[];
}

export interface TableColumn {
  header: string;
  field_path: string;
  format?: ColumnFormat;
  pref_width?: number;
}

export interface RowFilter {
  field_path: string;
  equals: string;
}

export interface RowAction {
  label: string;
  rpc: RpcCall;
  enabled_when?: RowFilter;
  refresh_on_success?: boolean;
}

export interface TablePanel {
  populate: RpcCall;
  rows_field: string;
  item_noun?: string;
  placeholder?: string;
  columns: TableColumn[];
  actions?: RowAction[];
}

export interface AdhocPanel {
  handler_id: string;
}

export interface IntegerSpinner {
  min?: number;
  max?: number;
  default_value?: number;
  step?: number;
}

export interface TextInput {
  default_value?: string;
}

export interface FormField {
  field_id: string;
  label: string;
  request_field: string;
  // proto oneof: exactly one of these is set.
  integer?: IntegerSpinner;
  text?: TextInput;
}

export interface LroPanel {
  start: RpcCall;
  metadata_type: string;
  response_type: string;
  run_button_label?: string;
  inputs?: FormField[];
  finalize?: RpcCall;
  result?: TablePanel;
}

export interface PanelDescriptor {
  panel_id: string;
  title: string;
  // proto oneof: exactly one of these is set.
  table?: TablePanel;
  lro?: LroPanel;
  adhoc?: AdhocPanel;
}

/** Context the wasm core expects when building requests. */
export interface RenderContext {
  currentResourcePath: string | null;
  uiIdentity: object | null;
  selectedRow: object | null;
  formValues: Record<string, unknown>;
}

/** One rendered row as returned by the wasm `renderTable` call. */
export interface RenderedRow {
  raw: Record<string, unknown>;
  cells: string[];
}

/** Host-supplied transport. Mirrors the Rust RpcInvoker trait. */
export interface RpcInvoker {
  invoke(
    service: string,
    method: string,
    request: object,
  ): Promise<object>;
}
