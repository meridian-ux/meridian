// Canonical PanelDescriptor fixtures — one per meridian.ui.v1 shape. This is the
// seed of the cross-renderer conformance corpus (the crank gate, COORDINATION
// §14): every renderer (web-components, react, tui, …) should render these same
// descriptors. They are built from the generated @savvifi/meridian-proto-ts schemas, so
// they can also be serialized (toBinary / toJson) and handed to non-JS renderers.

import { create } from "@bufbuild/protobuf";

import {
  ActionPanelSchema,
  AffordanceStyle,
} from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { CatalogPanelSchema } from "@savvifi/meridian-proto-ts/proto/catalog_pb.js";
import { ChoicePanelSchema } from "@savvifi/meridian-proto-ts/proto/choice_pb.js";
import { ConnectFlowPanelSchema } from "@savvifi/meridian-proto-ts/proto/connect_flow_pb.js";
import { CopyValuePanelSchema } from "@savvifi/meridian-proto-ts/proto/copy_value_pb.js";
import {
  FormFieldSchema,
  NestedFormSchema,
  RepeatedFieldSchema,
  TextInputSchema,
} from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { GalleryPanelSchema } from "@savvifi/meridian-proto-ts/proto/gallery_pb.js";
import { StepsPanelSchema } from "@savvifi/meridian-proto-ts/proto/steps_pb.js";
import { MediaPanelSchema, MediaKind } from "@savvifi/meridian-proto-ts/proto/media_pb.js";
import { LlmPromptPanelSchema } from "@savvifi/meridian-proto-ts/proto/llm_prompt_pb.js";
import { LroPanelSchema } from "@savvifi/meridian-proto-ts/proto/lro_pb.js";
import type { PanelDescriptor } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import {
  AdhocPanelSchema,
  FormMode,
  FormPanelSchema,
  PanelDescriptorSchema,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { PromptPanelSchema } from "@savvifi/meridian-proto-ts/proto/prompt_pb.js";
import { SnippetPanelSchema } from "@savvifi/meridian-proto-ts/proto/snippet_pb.js";
import { StatPanelSchema } from "@savvifi/meridian-proto-ts/proto/stat_pb.js";
import { TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";

export interface Fixture {
  name: string;
  /** The PanelDescriptor.body.case this fixture exercises. */
  shape: string;
  descriptor: PanelDescriptor;
}

export const FIXTURES: Fixture[] = [
  {
    name: "table",
    shape: "table",
    descriptor: create(PanelDescriptorSchema, {
      panelId: "claims",
      title: "Claims",
      body: {
        case: "table",
        value: create(TablePanelSchema, {
          columns: [{ header: "Member" }, { header: "Amount" }],
          placeholder: "no claims",
        }),
      },
    }),
  },
  {
    name: "prompt",
    shape: "prompt",
    descriptor: create(PanelDescriptorSchema, {
      panelId: "confirm",
      title: "Confirm deletion",
      body: {
        case: "prompt",
        value: create(PromptPanelSchema, {
          description: "Delete this resource?",
          fields: [create(FormFieldSchema, { fieldId: "reason", label: "Reason" })],
        }),
      },
    }),
  },
  {
    name: "lro",
    shape: "lro",
    descriptor: create(PanelDescriptorSchema, {
      panelId: "reindex",
      title: "Reindex search",
      body: {
        case: "lro",
        value: create(LroPanelSchema, { runButtonLabel: "Run reindex" }),
      },
    }),
  },
  {
    // Acceptance-criterion fixture: RepeatedField{object{label, kinds:RepeatedField{scalar}}}
    // Models nav.groups editing: add a section (object row with label + nested kinds array).
    name: "form",
    shape: "form",
    descriptor: create(PanelDescriptorSchema, {
      panelId: "nav-config",
      title: "Navigation",
      body: {
        case: "form",
        value: create(FormPanelSchema, {
          mode: FormMode.EDIT,
          fields: [
            create(FormFieldSchema, {
              fieldId: "groups",
              label: "Navigation groups",
              requestField: "nav.groups",
              kind: {
                case: "repeated",
                value: create(RepeatedFieldSchema, {
                  element: {
                    case: "object",
                    value: create(NestedFormSchema, {
                      fields: [
                        create(FormFieldSchema, {
                          fieldId: "label",
                          label: "Label",
                          requestField: "label",
                          kind: {
                            case: "text",
                            value: create(TextInputSchema, {}),
                          },
                        }),
                        create(FormFieldSchema, {
                          fieldId: "kinds",
                          label: "Kinds",
                          requestField: "kinds",
                          kind: {
                            case: "repeated",
                            value: create(RepeatedFieldSchema, {
                              element: {
                                case: "scalar",
                                value: create(FormFieldSchema, {
                                  fieldId: "kind",
                                  requestField: "kind",
                                  kind: {
                                    case: "text",
                                    value: create(TextInputSchema, {}),
                                  },
                                }),
                              },
                              addLabel: "Add kind",
                            }),
                          },
                        }),
                      ],
                    }),
                  },
                  addLabel: "Add section",
                }),
              },
            }),
          ],
        }),
      },
    }),
  },
  {
    name: "adhoc",
    shape: "adhoc",
    descriptor: create(PanelDescriptorSchema, {
      panelId: "dashboard",
      title: "Overview",
      body: {
        case: "adhoc",
        value: create(AdhocPanelSchema, { handlerId: "overview-dashboard" }),
      },
    }),
  },
  {
    name: "gallery",
    shape: "gallery",
    descriptor: create(PanelDescriptorSchema, {
      panelId: "assets",
      title: "Assets",
      body: {
        case: "gallery",
        value: create(GalleryPanelSchema, { placeholder: "no assets" }),
      },
    }),
  },
  {
    name: "llmPrompt",
    shape: "llmPrompt",
    descriptor: create(PanelDescriptorSchema, {
      panelId: "summarize",
      title: "Summarize",
      body: {
        case: "llmPrompt",
        value: create(LlmPromptPanelSchema, { description: "Summarize the document" }),
      },
    }),
  },
  {
    name: "choice",
    shape: "choice",
    descriptor: create(PanelDescriptorSchema, {
      panelId: "pick-agent",
      title: "Choose your agent",
      body: {
        case: "choice",
        value: create(ChoicePanelSchema, {
          prompt: "Which client?",
          defaultOptionId: "cursor",
          options: [
            { id: "cursor", label: "Cursor" },
            { id: "vscode", label: "VS Code" },
          ],
        }),
      },
    }),
  },
  {
    name: "snippet",
    shape: "snippet",
    descriptor: create(PanelDescriptorSchema, {
      panelId: "cursor-config",
      title: "Cursor config",
      body: {
        case: "snippet",
        value: create(SnippetPanelSchema, {
          snippet: {
            content: '{ "mcpServers": { "aion": { "url": "https://mcp.example/mcp" } } }',
            language: "json",
            path: "~/.cursor/mcp.json",
          },
        }),
      },
    }),
  },
  {
    name: "action",
    shape: "action",
    descriptor: create(PanelDescriptorSchema, {
      panelId: "install",
      title: "Install",
      body: {
        case: "action",
        value: create(ActionPanelSchema, {
          description: "One click adds it to Cursor.",
          action: {
            id: "add-to-cursor",
            label: "Add to Cursor",
            style: AffordanceStyle.PRIMARY,
            invoke: { case: "uri", value: "cursor://anysphere.cursor-deeplink/mcp/install" },
          },
        }),
      },
    }),
  },
  {
    name: "connectFlow",
    shape: "connectFlow",
    descriptor: create(PanelDescriptorSchema, {
      panelId: "connect",
      title: "Connect your agent",
      body: {
        case: "connectFlow",
        value: create(ConnectFlowPanelSchema, {
          prompt: "Every agent points at the same endpoint.",
          defaultTargetId: "cursor",
          endpoint: { label: "Endpoint", value: "mcp.example.com/mcp" },
          targets: [
            {
              id: "cursor",
              label: "Cursor",
              name: "Cursor",
              description: "One click installs it.",
              actions: [
                {
                  id: "add",
                  label: "Add to Cursor",
                  style: AffordanceStyle.PRIMARY,
                  invoke: { case: "uri", value: "cursor://install" },
                },
              ],
              configs: [
                {
                  content: '{ "mcpServers": { "aion": { "url": "https://mcp.example/mcp" } } }',
                  language: "json",
                  path: "~/.cursor/mcp.json",
                },
              ],
            },
            {
              id: "codex",
              label: "Codex",
              name: "Codex CLI",
              description: "Bridge the remote endpoint with mcp-remote.",
              configs: [
                {
                  content: '[mcp_servers.aion]\ncommand = "npx"\nargs = ["-y", "mcp-remote", "https://mcp.example/mcp"]',
                  language: "toml",
                  path: "~/.codex/config.toml",
                },
              ],
            },
          ],
        }),
      },
    }),
  },
  {
    name: "copyValue",
    shape: "copyValue",
    descriptor: create(PanelDescriptorSchema, {
      panelId: "endpoint",
      title: "Endpoint",
      body: {
        case: "copyValue",
        value: create(CopyValuePanelSchema, {
          value: { label: "Endpoint", value: "mcp.example.com/mcp" },
        }),
      },
    }),
  },
  {
    name: "catalog",
    shape: "catalog",
    descriptor: create(PanelDescriptorSchema, {
      panelId: "capabilities",
      title: "Capabilities",
      body: {
        case: "catalog",
        value: create(CatalogPanelSchema, {
          items: [
            {
              id: "list_instances",
              name: "list_instances",
              description: "The instances you can address.",
              tag: "tool",
            },
            {
              id: "graph",
              name: "graph_*",
              description: "RLS-respecting reads.",
              state: "Next",
            },
          ],
        }),
      },
    }),
  },
  {
    name: "stat",
    shape: "stat",
    descriptor: create(PanelDescriptorSchema, {
      panelId: "headcount",
      title: "Headcount",
      body: {
        case: "stat",
        value: create(StatPanelSchema, {
          label: "Active employees",
          value: 1240,
          format: 1,
          previous: 1180,
          series: [1180, 1200, 1220, 1240],
          higherIsBetter: true,
        }),
      },
    }),
  },
  {
    name: "steps",
    shape: "steps",
    descriptor: create(PanelDescriptorSchema, {
      panelId: "create_sponsor",
      title: "Create a sponsor",
      body: {
        case: "steps",
        value: create(StepsPanelSchema, {
          intro: "Add an employer and confirm a colleague can see it.",
          steps: [
            {
              label: "Open the Sponsors page",
              detail: "The list of every employer your organization administers.",
              actor: "Admin",
              mediaUri: "/evidence/sponsors.png",
              mediaAlt: "The sponsors list",
            },
            {
              label: "Add a new sponsor",
              detail: "Name it, then set Status to Active and Kind to Customer.",
              actor: "Admin",
            },
            {
              label: "Confirm a colleague sees it",
              detail: "Everyone in your organization shares one sponsor list.",
              actor: "Manager",
            },
          ],
          outro: "The sponsor is now visible to your whole team.",
        }),
      },
    }),
  },
  {
    name: "media",
    shape: "media",
    descriptor: create(PanelDescriptorSchema, {
      panelId: "walkthrough_video",
      title: "Walkthrough",
      body: {
        case: "media",
        value: create(MediaPanelSchema, {
          kind: MediaKind.VIDEO,
          srcUri: "/evidence/golden-path.mp4",
          posterUri: "/evidence/golden-path.png",
          captionsUri: "/evidence/golden-path.vtt",
          alt: "A four-minute walkthrough of creating a sponsor.",
          durationMs: 252000,
          caption: "Narrated from a live run.",
          chapters: [
            { startMs: 0, label: "Open the page" },
            { startMs: 65000, label: "Add the sponsor" },
          ],
        }),
      },
    }),
  },
  {
    name: "empty",
    shape: "(unset)",
    descriptor: create(PanelDescriptorSchema, { panelId: "blank", title: "Blank" }),
  },
];
