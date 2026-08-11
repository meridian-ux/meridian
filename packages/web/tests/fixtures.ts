// Canonical PanelDescriptor fixtures — one per shape renderPanel handles — built
// from the @savvifi/meridian-proto-ts schemas. These are the shared "crank" seed:
// the same descriptors every renderer (web-components here, react, tui, …) must
// render. Because they are real protobuf-es messages, they round-trip through
// toBinary/fromBinary exactly as the wasm boundary requires.

import { create } from "@bufbuild/protobuf";
import {
  PanelDescriptorSchema,
  type PanelDescriptor,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";

export const tableFixture: PanelDescriptor = create(PanelDescriptorSchema, {
  panelId: "users",
  title: "Users",
  body: {
    case: "table",
    value: {
      populate: { service: "acme.Users", method: "ListUsers" },
      rowsField: "users",
      itemNoun: "users",
      placeholder: "No users yet",
      columns: [
        { header: "Name", fieldPath: "name" },
        { header: "Email", fieldPath: "email", prefWidth: 240 },
      ],
    },
  },
});

export const lroFixture: PanelDescriptor = create(PanelDescriptorSchema, {
  panelId: "reindex",
  title: "Reindex",
  body: {
    case: "lro",
    value: {
      start: { service: "acme.Search", method: "Reindex" },
      runButtonLabel: "Reindex now",
      inputs: [
        {
          fieldId: "shards",
          label: "Shards",
          requestField: "shards",
          kind: { case: "integer", value: { min: 1, max: 16, defaultValue: 4, step: 1 } },
        },
      ],
      result: {
        rowsField: "docs",
        itemNoun: "docs",
        columns: [{ header: "Doc", fieldPath: "id" }],
      },
    },
  },
});

export const adhocFixture: PanelDescriptor = create(PanelDescriptorSchema, {
  panelId: "custom",
  title: "Custom",
  body: { case: "adhoc", value: { handlerId: "my-handler" } },
});

// ── content shapes (static, brand-neutral) ──────────────────────────────────
export const choiceFixture: PanelDescriptor = create(PanelDescriptorSchema, {
  panelId: "pick",
  title: "Choose your agent",
  body: {
    case: "choice",
    value: {
      defaultOptionId: "cursor",
      options: [
        { id: "cursor", label: "Cursor", description: "the AI editor", icon: "cursor" },
        { id: "zed", label: "Zed" },
      ],
    },
  },
});

export const snippetFixture: PanelDescriptor = create(PanelDescriptorSchema, {
  panelId: "cfg",
  title: "Cursor config",
  body: {
    case: "snippet",
    value: { snippet: { content: '{ "aion": {} }', language: "json", path: "~/.cursor/mcp.json" } },
  },
});

export const actionFixture: PanelDescriptor = create(PanelDescriptorSchema, {
  panelId: "install",
  title: "Install",
  body: {
    case: "action",
    value: {
      description: "One click.",
      action: { id: "add", label: "Add to Cursor", icon: "download", invoke: { case: "uri", value: "cursor://install" } },
    },
  },
});

export const copyValueFixture: PanelDescriptor = create(PanelDescriptorSchema, {
  panelId: "tok",
  title: "Token",
  body: { case: "copyValue", value: { value: { label: "Token", value: "sk-abc123", secret: true } } },
});

export const connectFlowFixture: PanelDescriptor = create(PanelDescriptorSchema, {
  panelId: "connect",
  title: "Connect your agent",
  body: {
    case: "connectFlow",
    value: {
      prompt: "Same endpoint everywhere.",
      defaultTargetId: "cursor",
      endpoint: { label: "Endpoint", value: "mcp.example.com/mcp" },
      targets: [
        {
          id: "cursor",
          label: "Cursor",
          name: "Cursor",
          icon: "cursor",
          actions: [{ id: "add", label: "Add to Cursor", description: "opens Cursor", invoke: { case: "uri", value: "cursor://install" } }],
          configs: [{ content: '{ "aion": {} }', language: "json", path: "~/.cursor/mcp.json" }],
        },
        { id: "zed", label: "Zed", name: "Zed", configs: [{ content: "settings", language: "json", path: "settings.json" }] },
      ],
    },
  },
});

export const catalogFixture: PanelDescriptor = create(PanelDescriptorSchema, {
  panelId: "caps",
  title: "Capabilities",
  body: {
    case: "catalog",
    value: {
      items: [
        { id: "li", name: "list_instances", tag: "tool", description: "start here", icon: "tool" },
        { id: "gr", name: "graph_*", state: "Next", description: "reads" },
      ],
    },
  },
});

// ── specialized panels ──────────────────────────────────────────────────────
// GrammarLanguage: 1=MARKDOWN 2=MERMAID 3=PLANTUML 4=GRAPHVIZ 5=VEGA_LITE 6=VEGA
export const markdownGrammarFixture: PanelDescriptor = create(PanelDescriptorSchema, {
  panelId: "readme",
  title: "Readme",
  body: {
    case: "grammar",
    value: { language: 1, source: "# Hello\n\n**bold** and `code`\n\n- one\n- two" },
  },
});

export const mermaidGrammarFixture: PanelDescriptor = create(PanelDescriptorSchema, {
  panelId: "flow",
  title: "Flow",
  body: {
    case: "grammar",
    value: { language: 2, source: "graph TD; A-->B", alt: "flowchart: A to B", caption: "the flow" },
  },
});

export const vegaGrammarFixture: PanelDescriptor = create(PanelDescriptorSchema, {
  panelId: "chart",
  title: "Chart",
  body: {
    case: "grammar",
    value: { language: 5, source: '{"mark":"bar","data":{"values":[1,2,3]}}' },
  },
});

// StatPanel: a rising churn metric — higher_is_better=false → the increase is BAD.
export const statFixture: PanelDescriptor = create(PanelDescriptorSchema, {
  panelId: "churn",
  title: "Churn",
  body: {
    case: "stat",
    value: { label: "Churn rate", value: 5.2, format: 2, previous: 4.0, series: [4, 4.5, 5, 5.2], higherIsBetter: false },
  },
});

// A table with everything the shape has always DESCRIBED but the renderer used
// to drop: RowActions (one unconditional, one gated by `enabled_when`) and a
// ColumnLink whose destination only the host can resolve.
export const tableWithActionsFixture: PanelDescriptor = create(PanelDescriptorSchema, {
  panelId: "builds",
  title: "Builds",
  body: {
    case: "table",
    value: {
      populate: { service: "acme.Builds", method: "ListBuilds" },
      rowsField: "builds",
      itemNoun: "builds",
      columns: [
        { header: "Repo", fieldPath: "repo", link: { targetKind: "acme.Build" } },
        { header: "Phase", fieldPath: "phase" },
      ],
      actions: [
        {
          label: "Targets",
          rpc: {
            service: "acme.Builds",
            method: "ListBuildTargets",
            bindings: [{ requestField: "name", source: { case: "rowField", value: "name" } }],
          },
        },
        {
          // Only meaningful on a finished build — the `enabled_when` predicate.
          label: "Artifacts",
          rpc: { service: "acme.Builds", method: "ListBuildArtifacts" },
          enabledWhen: { fieldPath: "phase", equals: "Succeeded" },
        },
      ],
    },
  },
});

// StreamPanel: a build log. `line_field` selects the text out of a structured
// frame; `max_lines` bounds retention.
export const streamFixture: PanelDescriptor = create(PanelDescriptorSchema, {
  panelId: "build_log",
  title: "Build log",
  body: {
    case: "stream",
    value: {
      subscribe: { service: "acme.Builds", method: "StreamBuildLog" },
      lineField: "line",
      maxLines: 3,
      itemNoun: "lines",
      placeholder: "Waiting for the build to start…",
    },
  },
});
