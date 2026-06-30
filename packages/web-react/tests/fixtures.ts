// Canonical PanelDescriptor fixtures — one per meridian.ui.v1 shape. This is the
// seed of the cross-renderer conformance corpus (the crank gate, COORDINATION
// §14): every renderer (web-components, react, tui, …) should render these same
// descriptors. They are built from the generated @meridian/proto-ts schemas, so
// they can also be serialized (toBinary / toJson) and handed to non-JS renderers.

import { create } from "@bufbuild/protobuf";

import { FormFieldSchema } from "@meridian/proto-ts/proto/form_pb.js";
import { GalleryPanelSchema } from "@meridian/proto-ts/proto/gallery_pb.js";
import { LlmPromptPanelSchema } from "@meridian/proto-ts/proto/llm_prompt_pb.js";
import { LroPanelSchema } from "@meridian/proto-ts/proto/lro_pb.js";
import type { PanelDescriptor } from "@meridian/proto-ts/proto/panel_pb.js";
import {
  AdhocPanelSchema,
  PanelDescriptorSchema,
} from "@meridian/proto-ts/proto/panel_pb.js";
import { PromptPanelSchema } from "@meridian/proto-ts/proto/prompt_pb.js";
import { TablePanelSchema } from "@meridian/proto-ts/proto/table_pb.js";

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
    name: "empty",
    shape: "(unset)",
    descriptor: create(PanelDescriptorSchema, { panelId: "blank", title: "Blank" }),
  },
];
