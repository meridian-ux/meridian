// Field-completeness guard for the content shapes across BOTH reference kits —
// the regressions an adversarial parity audit caught: option/affordance
// descriptions, the icon seam, CopyValue secret+reveal, and ConnectFlow's empty
// placeholder. These render through the shared content_shapes module, so one
// assertion set covers htmlKit AND shadcnKit.

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AffordanceStyle } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { CatalogPanelSchema } from "@savvifi/meridian-proto-ts/proto/catalog_pb.js";
import { ChoicePanelSchema } from "@savvifi/meridian-proto-ts/proto/choice_pb.js";
import { ConnectFlowPanelSchema } from "@savvifi/meridian-proto-ts/proto/connect_flow_pb.js";
import { CopyValuePanelSchema } from "@savvifi/meridian-proto-ts/proto/copy_value_pb.js";
import { ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import {
  PanelDescriptorSchema,
  type PanelDescriptor,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import type { ComponentKit } from "../src/component_kit.js";
import { htmlKit } from "../src/html_kit.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { MeridianProvider } from "../src/provider.js";
import { shadcnKit } from "../src/shadcn_kit.js";

const invoker: RpcInvoker = { invoke: async () => ({}) };

function render(kit: ComponentKit, descriptor: PanelDescriptor, withIcons = false): string {
  return renderToStaticMarkup(
    createElement(
      MeridianProvider,
      {
        invoker,
        kit,
        adhoc: {},
        // A host glyph resolver: maps the icon KEY to a marker we can assert on.
        renderIcon: withIcons ? (key: string) => createElement("i", { className: `glyph-${key}` }) : undefined,
      },
      createElement(PanelRenderer, { descriptor }),
    ),
  );
}

const kits: [string, ComponentKit][] = [
  ["htmlKit", htmlKit],
  ["shadcnKit", shadcnKit],
];

const choice = create(PanelDescriptorSchema, {
  panelId: "c",
  title: "Choice",
  body: {
    case: "choice",
    value: create(ChoicePanelSchema, {
      options: [
        { id: "cursor", label: "Cursor", description: "the AI editor", icon: "cursor" },
        { id: "zed", label: "Zed" },
      ],
    }),
  },
});

const catalog = create(PanelDescriptorSchema, {
  panelId: "cat",
  title: "Catalog",
  body: {
    case: "catalog",
    value: create(CatalogPanelSchema, {
      items: [
        {
          id: "gh",
          name: "GitHub",
          icon: "github",
          action: {
            id: "open",
            label: "Open",
            description: "opens the repo", // Affordance.description WITHOUT ActionPanel
            invoke: { case: "uri", value: "https://example.com" },
          },
        },
      ],
    }),
  },
});

const secret = create(PanelDescriptorSchema, {
  panelId: "s",
  title: "Secret",
  body: {
    case: "copyValue",
    value: create(CopyValuePanelSchema, {
      value: { label: "Token", value: "sk-abc123", secret: true },
    }),
  },
});

const emptyFlow = create(PanelDescriptorSchema, {
  panelId: "ef",
  title: "Empty flow",
  body: {
    case: "connectFlow",
    value: create(ConnectFlowPanelSchema, { placeholder: "No clients yet", targets: [] }),
  },
});

describe.each(kits)("content field-completeness (%s)", (_name, kit) => {
  it("Choice renders per-option description", () => {
    expect(render(kit, choice)).toContain("the AI editor");
  });

  it("icon key is never dropped (data-icon) and the host glyph renders when wired", () => {
    const noResolver = render(kit, choice);
    expect(noResolver).toContain('data-icon="cursor"'); // key survives with no resolver
    const withResolver = render(kit, choice, true);
    expect(withResolver).toContain("glyph-cursor"); // host glyph drawn
  });

  it("Affordance.description renders even nested in a CatalogItem (no ActionPanel wrapper)", () => {
    expect(render(kit, catalog)).toContain("opens the repo");
    expect(render(kit, catalog)).toContain('data-icon="github"');
  });

  it("CopyValue secret masks + exposes a reveal affordance (plaintext still copyable)", () => {
    const html = render(kit, secret);
    expect(html).toContain("••••••••"); // masked
    expect(html).toContain("data-reveal"); // reveal affordance
    expect(html).toContain('data-copy="sk-abc123"'); // copy yields plaintext
  });

  it("CopyValue applies declared display while preserving the raw copy source", () => {
    const typed = create(PanelDescriptorSchema, {
      panelId: "typed",
      title: "Typed",
      body: {
        case: "copyValue",
        value: create(CopyValuePanelSchema, {
          value: { value: "2026-03-29", display: { type: ValueType.DATE } },
        }),
      },
    });
    const decoded = fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, typed));
    const html = render(kit, decoded);
    expect(html).toContain("Mar 29, 2026");
    expect(html).toContain('data-copy="2026-03-29"');
  });

  it("formats nested revealed values while unspecified displays keep literal text", () => {
    const nested = create(PanelDescriptorSchema, { body: { case: "connectFlow", value: {
      endpoint: { value: "2026-03-29", secret: true, display: { type: ValueType.DATE } },
    } } });
    const html = render(kit, nested);
    expect(html).toContain("••••••••");
    expect(html).toMatch(/data-plain[^>]*hidden[^>]*>Mar 29, 2026/);
    expect(html).toContain('data-copy="2026-03-29"');
    for (const display of [undefined, {}]) {
      const legacy = create(PanelDescriptorSchema, { body: { case: "copyValue", value: {
        value: { value: "2026-03-29", display },
      } } });
      const output = render(kit, legacy);
      expect(output).not.toContain("Mar 29, 2026");
      expect(output).toContain('>2026-03-29</code>');
    }
  });

  it("ConnectFlow with no targets renders the placeholder", () => {
    expect(render(kit, emptyFlow)).toContain("No clients yet");
  });
});
