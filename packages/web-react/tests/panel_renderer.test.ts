// Runtime proof that the React renderer dispatches a PanelDescriptor through a
// ComponentKit. Uses react-dom/server (node env, no jsdom) + createElement (no
// JSX transpile needed). This is the React-side seed of the cross-renderer
// conformance idea: the same descriptor that the web-components renderer hosts
// renders here through htmlKit.

import { create } from "@bufbuild/protobuf";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PanelDescriptor } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { TablePanelSchema } from "@savvifi/meridian-proto-ts/proto/table_pb.js";
import { StreamPanelSchema } from "@savvifi/meridian-proto-ts/proto/stream_pb.js";
import { MediaKind, MediaPanelSchema } from "@savvifi/meridian-proto-ts/proto/media_pb.js";
import { TerminalPanelSchema } from "@savvifi/meridian-proto-ts/proto/terminal_pb.js";
import { StepsPanelSchema } from "@savvifi/meridian-proto-ts/proto/steps_pb.js";
import { DetailHeaderPanelSchema, RecordCardPanelSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { PrincipalDisplay, ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { MeridianInitialDataContext } from "../src/pagination.js";
import { MeridianProvider } from "../src/provider.js";

const invoker: RpcInvoker = { invoke: async () => ({}) };

function render(descriptor: PanelDescriptor, kit = htmlKit): string {
  return renderToStaticMarkup(
    createElement(
      MeridianProvider,
      { invoker, kit, adhoc: {} },
      createElement(PanelRenderer, { descriptor }),
    ),
  );
}

function renderWithInitialData(
  descriptor: PanelDescriptor,
  initialData: Record<string, { rows: Array<Record<string, unknown>> }>,
  kit = htmlKit,
  resolveHref?: (entityType: string, entityId: string) => string | undefined,
): string {
  return renderToStaticMarkup(
    createElement(
      MeridianProvider,
      { invoker, kit, adhoc: {}, resolveHref },
      createElement(
        MeridianInitialDataContext.Provider,
        { value: initialData },
        createElement(PanelRenderer, { descriptor }),
      ),
    ),
  );
}

describe("meridian-web-react renderer", () => {
  it("renders a TablePanel through htmlKit (title + column headers + placeholder)", () => {
    const descriptor = create(PanelDescriptorSchema, {
      panelId: "claims",
      title: "Claims",
      body: {
        case: "table",
        value: create(TablePanelSchema, {
          columns: [{ header: "Member" }, { header: "Amount" }],
          placeholder: "no claims",
        }),
      },
    });
    const html = render(descriptor);
    expect(html).toContain("Claims");
    expect(html).toContain("Member");
    expect(html).toContain("Amount");
    expect(html).toContain("no claims");
  });

  it("falls back for an unset panel body", () => {
    const descriptor = create(PanelDescriptorSchema, { panelId: "x", title: "X" });
    expect(render(descriptor)).toContain("empty panel");
  });

  it("renders a StreamPanel through htmlKit with an accessible placeholder", () => {
    const descriptor = create(PanelDescriptorSchema, {
      panelId: "build-log",
      title: "Build log",
      body: {
        case: "stream",
        value: create(StreamPanelSchema, {
          placeholder: "Waiting for build events...",
          itemNoun: "events",
        }),
      },
    });
    const html = render(descriptor);
    expect(html).toContain('class="mer-stream"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Waiting for build events...");
  });

  it("renders detail header and record card semantics through htmlKit", () => {
    const header = render(create(PanelDescriptorSchema, {
      panelId: "header",
      body: { case: "detailHeader", value: create(DetailHeaderPanelSchema, {
        title: "Sponsor", subtitleSourcePath: "data.owner", statusSourcePath: "data.status",
        descriptorRows: [{ label: "Type", sourcePath: "data.type" }],
      }) },
    }));
    expect(header).toContain("Sponsor");
    expect(header).toContain("data.owner");
    expect(header).toContain("data.status");
    expect(header).toContain("data.type");

    const card = render(create(PanelDescriptorSchema, {
      panelId: "card",
      body: { case: "recordCard", value: create(RecordCardPanelSchema, {
        itemNoun: "sponsor", fields: [{ fieldId: "name", label: "Name" }],
      }) },
    }));
    expect(card).toContain('aria-label="sponsor"');
    expect(card).toContain("Name");
    expect(card).toContain("name");
  });

  it("renders shadcn detail headers through the same dispatch seam", () => {
    const html = render(create(PanelDescriptorSchema, {
      panelId: "header",
      body: { case: "detailHeader", value: create(DetailHeaderPanelSchema, {
        title: "Profile", descriptorRows: [{ label: "Type", sourcePath: "data.type" }],
      }) },
    }), shadcnKit);
    expect(html).toContain("Profile");
    expect(html).toContain("Record summary");
    expect(html).toContain("data.type");
  });

  it("realizes seeded detail values through the shared formatter in both reference kits", () => {
    const header = create(PanelDescriptorSchema, {
      panelId: "header",
      body: {
        case: "detailHeader",
        value: create(DetailHeaderPanelSchema, {
          titleSourcePath: "name",
          populate: { service: "acme.Builds", method: "GetBuild" },
          descriptorRows: [
            { label: "Healthy", sourcePath: "healthy", display: { type: ValueType.BOOLEAN } },
            { label: "Score", sourcePath: "score", display: { type: ValueType.DECIMAL, options: { case: "number", value: { fractionDigits: 2 } } } },
          ],
        }),
      },
    });
    const card = create(PanelDescriptorSchema, {
      panelId: "card",
      body: {
        case: "recordCard",
        value: create(RecordCardPanelSchema, {
          populate: { service: "acme.Builds", method: "GetBuild" },
          fields: [
            { fieldId: "healthy", label: "Healthy", display: { type: ValueType.BOOLEAN } },
            { fieldId: "score", label: "Score", display: { type: ValueType.DECIMAL, options: { case: "number", value: { fractionDigits: 2 } } } },
            { fieldId: "owner", label: "Owner", display: { type: ValueType.PRINCIPAL, options: { case: "principal", value: { display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE } } } },
          ],
        }),
      },
    });
    const initialData = {
      "acme.Builds.GetBuild": {
        rows: [{ name: "Build 42", healthy: true, score: 1.236, owner: "Ruchi Sharma <ruchi@example.com>" }],
      },
    };

    for (const kit of [htmlKit, shadcnKit]) {
      const headerHtml = renderWithInitialData(header, initialData, kit);
      const cardHtml = renderWithInitialData(card, initialData, kit);
      expect(headerHtml).toContain("Build 42");
      expect(headerHtml).toContain("Healthy");
      expect(headerHtml).toContain("Yes");
      expect(headerHtml).toContain("1.24");
      expect(cardHtml).toContain("Healthy");
      expect(cardHtml).toContain("Yes");
      expect(cardHtml).toContain("1.24");
      expect(cardHtml).toContain("Ruchi Sharma");
      expect(cardHtml).toContain('title="ruchi@example.com"');
    }
  });

  it("realizes only http URL values as safe links", () => {
    const card = create(PanelDescriptorSchema, {
      panelId: "links",
      body: { case: "recordCard", value: create(RecordCardPanelSchema, {
        populate: { service: "acme.Builds", method: "GetBuild" },
        fields: [{ fieldId: "url", label: "URL", display: { type: ValueType.URL } }],
      }) },
    });
    const initialData = { "acme.Builds.GetBuild": {
      rows: [{ url: "https://example.com/docs" }],
    } };
    for (const kit of [htmlKit, shadcnKit]) {
      const safe = renderWithInitialData(card, initialData, kit);
      expect(safe).toContain('<a href="https://example.com/docs"');
      expect(safe).toContain("https://example.com/docs</a>");

      for (const value of ["javascript:alert(1)", "data:text/html,unsafe"]) {
        const unsafe = renderWithInitialData(
          card,
          { "acme.Builds.GetBuild": { rows: [{ url: value }] } },
          kit,
        );
        expect(unsafe).not.toContain("<a ");
        expect(unsafe).toContain(value);
      }
    }
  });

  it("uses the host resolver for declared principal record links", () => {
    const card = create(PanelDescriptorSchema, {
      panelId: "principal-link",
      body: {
        case: "recordCard",
        value: create(RecordCardPanelSchema, {
          populate: { service: "acme.Builds", method: "GetBuild" },
          fields: [{
            fieldId: "ownerId",
            label: "Owner",
            display: {
              type: ValueType.PRINCIPAL,
              options: { case: "principal", value: { linkToRecord: true, targetKind: "identity.user" } },
            },
          }],
        }),
      },
    });
    for (const kit of [htmlKit, shadcnKit]) {
      const html = renderWithInitialData(
        card,
        { "acme.Builds.GetBuild": { rows: [{ ownerId: "user_123" }] } },
        kit,
        (kind, id) => `/directory/${kind}/${id}`,
      );
      expect(html).toContain('href="/directory/identity.user/user_123"');
      expect(html).toContain(">user_123</a>");
    }
  });

for (const shape of ["recordCard", "detailHeader"] as const) {
    it(`${shape} honors explicit ValueLink precedence over direct URL behavior`, () => {
      for (const kit of [htmlKit, shadcnKit]) for (const scenario of ["resolved", "no-resolver", "declined", "empty-href", "blank-kind", "absent-link"] as const) {
        const raw = "https://example.com/raw";
      const display = {
        type: ValueType.URL,
        link: scenario === "absent-link" ? undefined : { targetKind: scenario === "blank-kind" ? " " : "build" },
      };
      const populate = { service: "acme.Builds", method: "GetBuild" };
      const descriptor = create(PanelDescriptorSchema, {
        panelId: "value-link",
        body: shape === "recordCard"
          ? { case: shape, value: { populate, fields: [{ fieldId: "value", display }] } }
          : { case: shape, value: { populate, descriptorRows: [{ sourcePath: "value", display }] } },
      });
      const resolver = vi.fn(() => scenario === "declined" ? undefined : scenario === "empty-href" ? "" : "/host-selected");
        const html = renderWithInitialData(descriptor, {
          "acme.Builds.GetBuild": { rows: [{ value: raw }] },
        }, kit, scenario === "no-resolver" ? undefined : resolver);
        if (scenario === "resolved") {
          expect(html).toContain('href="/host-selected"');
          expect(html).not.toContain('target="_blank"');
        } else if (scenario === "absent-link") {
          expect(html).toContain('href="https://example.com/raw"');
          expect(html).toContain('target="_blank"');
        } else expect(html).not.toContain("<a ");
        expect(html).toContain(raw);
        if (["no-resolver", "blank-kind", "absent-link"].includes(scenario)) {
          expect(resolver).not.toHaveBeenCalled();
        } else expect(resolver).toHaveBeenCalledWith("build", raw);
      }
    });
  }

  it("uses the host resolver for a general ValueLink", () => {
    const card = create(PanelDescriptorSchema, {
      panelId: "build-link",
      body: {
        case: "recordCard",
        value: create(RecordCardPanelSchema, {
          populate: { service: "acme.Builds", method: "GetBuild" },
          fields: [{
            fieldId: "buildId",
            label: "Build",
            display: { type: ValueType.IDENTIFIER, link: { targetKind: "build" } },
          }],
        }),
      },
    });
    for (const kit of [htmlKit, shadcnKit]) {
      const html = renderWithInitialData(
        card,
        { "acme.Builds.GetBuild": { rows: [{ buildId: "build_123" }] } },
        kit,
        (kind, id) => `/builds/${kind}/${id}`,
      );
      expect(html).toContain('href="/builds/build/build_123"');
      expect(html).toContain(">build_123</a>");
    }
  });

  for (const shape of ["recordCard", "detailHeader"] as const) {
    it(`${shape} preserves principal labels and requires a host-approved destination`, () => {
      for (const kit of [htmlKit, shadcnKit]) {
        for (const scenario of ["principal", "email", "no-resolver", "declined", "empty-href", "no-kind", "disabled"] as const) {
          const raw = "Ruchi Sharma <ruchi@example.com>";
          const display = {
            type: scenario === "email" ? ValueType.EMAIL : ValueType.PRINCIPAL,
            options: { case: "principal" as const, value: {
              display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE,
              linkToRecord: scenario !== "disabled",
              targetKind: scenario === "no-kind" ? "" : "identity.user",
            } },
          };
          const populate = { service: "acme.Builds", method: "GetBuild" };
          const descriptor = create(PanelDescriptorSchema, {
            panelId: "principal",
            body: shape === "recordCard"
              ? { case: shape, value: { populate, fields: [{ fieldId: "owner", display }] } }
              : { case: shape, value: { populate, descriptorRows: [{ sourcePath: "owner", display }] } },
          });
          const resolveHref = vi.fn(() => scenario === "declined" ? undefined : scenario === "empty-href" ? "" : "/people/host-selected");
          const html = renderWithInitialData(descriptor, {
            "acme.Builds.GetBuild": { rows: [{ owner: raw }] },
          }, kit, scenario === "no-resolver" ? undefined : resolveHref);
          expect(html).toContain('title="ruchi@example.com"');
          expect(html).toContain("Ruchi Sharma");
          if (scenario === "principal" || scenario === "email") {
            expect(html).toContain('href="/people/host-selected"');
            expect(html).not.toContain('target="_blank"');
          } else expect(html).not.toContain("<a ");
          if (["no-resolver", "no-kind", "disabled"].includes(scenario)) {
            expect(resolveHref).not.toHaveBeenCalled();
          } else expect(resolveHref).toHaveBeenCalledWith("identity.user", raw);
        }
      }
    });
  }

  it("renders HTML media with poster, captions, and accessible text", () => {
    const html = render(create(PanelDescriptorSchema, {
      panelId: "demo-video",
      body: { case: "media", value: create(MediaPanelSchema, {
        kind: MediaKind.VIDEO,
        srcUri: "/demo.mp4",
        posterUri: "/poster.jpg",
        captionsUri: "/demo.vtt",
        alt: "A demo walkthrough",
        caption: "Product demo",
        chapters: [{ startMs: 65_000, label: "Add the sponsor" }],
      }) },
    }));
    expect(html).toContain('class="mer-media"');
    expect(html).toContain('poster="/poster.jpg"');
    expect(html).toContain('src="/demo.vtt"');
    expect(html).toContain("Product demo");
    expect(html).toContain('data-start-ms="65000"');
    expect(html).toContain('dateTime="PT65S"');
    expect(html).toContain("1:05</time> Add the sponsor");
  });

  it("renders shadcn media with captions and poster semantics", () => {
    const html = render(create(PanelDescriptorSchema, {
      panelId: "shadcn-video",
      body: { case: "media", value: create(MediaPanelSchema, {
        kind: MediaKind.VIDEO, srcUri: "/demo.mp4", posterUri: "/poster.jpg",
        captionsUri: "/demo.vtt", alt: "A demo walkthrough", caption: "Product demo",
        chapters: [{ startMs: 65_000, label: "Add the sponsor" }],
      }) },
    }), shadcnKit);
    expect(html).toContain('poster="/poster.jpg"');
    expect(html).toContain('src="/demo.vtt"');
    expect(html).toContain("Product demo");
    expect(html).toContain('data-start-ms="65000"');
    expect(html).toContain("1:05</time> Add the sponsor");
  });

  it("renders HTML steps as an ordered accessible list", () => {
    const html = render(create(PanelDescriptorSchema, {
      panelId: "walkthrough",
      body: { case: "steps", value: create(StepsPanelSchema, {
        intro: "Get started",
        steps: [
          { label: "Open settings", actor: "Admin", detail: "Choose production" },
          { label: "Deploy", mediaAlt: "Press deploy to continue" },
        ],
        outro: "You are done",
      }) },
    }));
    expect(html).toContain('class="mer-steps"');
    expect(html).toContain("<ol>");
    expect(html).toContain("Open settings");
    expect(html).toContain("(Admin)");
    expect(html).toContain("Press deploy to continue");
    expect(html).toContain("You are done");
  });

  it("renders terminal connection metadata instead of a blank panel", () => {
    const html = render(create(PanelDescriptorSchema, {
      panelId: "shell",
      body: { case: "terminal", value: create(TerminalPanelSchema, { url: "wss://example.test/pty", tool: "bash", cols: 80, rows: 24 }) },
    }));
    expect(html).toContain("Interactive terminal connection");
    expect(html).toContain("wss://example.test/pty");
    expect(html).toContain("80 × 24");
  });

  it("uses the core terminal degradation when a kit omits the specialized renderer", () => {
    const html = render(create(PanelDescriptorSchema, {
      panelId: "shell",
      body: { case: "terminal", value: create(TerminalPanelSchema, { url: "wss://example.test/pty", tool: "bash", cols: 80, rows: 24 }) },
    }), { ...htmlKit, Terminal: undefined });
    expect(html).toContain('class="mer-terminal"');
    expect(html).toContain('aria-label="bash"');
    expect(html).toContain("wss://example.test/pty");
    expect(html).toContain("80 × 24");
  });

  it("degrades rejected terminal broker URLs across reference and fallback renderers", () => {
    const descriptor = create(PanelDescriptorSchema, {
      panelId: "unsafe-shell",
      body: { case: "terminal", value: create(TerminalPanelSchema, {
        url: "javascript:alert(1)",
        tool: "bash",
      }) },
    });

    for (const kit of [htmlKit, shadcnKit, { ...htmlKit, Terminal: undefined }]) {
      const html = render(descriptor, kit);
      expect(html).not.toContain('href="javascript:alert(1)"');
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain("expected a ws:// or wss:// broker URL");
      expect(html).toContain("javascript:alert(1)");
    }
  });
});
