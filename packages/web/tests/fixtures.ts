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
