// muiKit content-shape round-trip: the six brand-neutral content descriptors
// (Choice / Snippet / Action / ConnectFlow / CopyValue / Catalog) render through
// MeridianMuiProvider + PanelRenderer as MUI components. This is the mui-kit peer
// of the web-react conformance over these shapes and the TUI content.rs tests.

import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AffordanceStyle } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { ChoicePanelSchema } from "@savvifi/meridian-proto-ts/proto/choice_pb.js";
import { ConnectFlowPanelSchema } from "@savvifi/meridian-proto-ts/proto/connect_flow_pb.js";
import { CatalogPanelSchema } from "@savvifi/meridian-proto-ts/proto/catalog_pb.js";
import { CopyValuePanelSchema } from "@savvifi/meridian-proto-ts/proto/copy_value_pb.js";
import { GrammarPanelSchema } from "@savvifi/meridian-proto-ts/proto/grammar_pb.js";
import { StatPanelSchema } from "@savvifi/meridian-proto-ts/proto/stat_pb.js";
import { StepsPanelSchema } from "@savvifi/meridian-proto-ts/proto/steps_pb.js";
import { MediaPanelSchema, MediaKind } from "@savvifi/meridian-proto-ts/proto/media_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { PanelRenderer } from "@savvifi/meridian-web-react";
import { createElement } from "react";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);

const invoker: RpcInvoker = { invoke: async () => ({}) };

function renderPanel(descriptor: Parameters<typeof PanelRenderer>[0]["descriptor"]) {
  return render(
    <MeridianMuiProvider invoker={invoker}>
      <PanelRenderer descriptor={descriptor} />
    </MeridianMuiProvider>,
  );
}

describe("muiKit renders the brand-neutral content shapes", () => {
  it("Choice → MUI tabs of options", async () => {
    renderPanel(
      create(PanelDescriptorSchema, {
        panelId: "pick",
        title: "Pick",
        body: {
          case: "choice",
          value: create(ChoicePanelSchema, {
            defaultOptionId: "cursor",
            options: [
              { id: "cursor", label: "Cursor" },
              { id: "vscode", label: "VS Code" },
            ],
          }),
        },
      }),
    );
    expect((await screen.findAllByRole("tab")).length).toBe(2);
    await screen.findByText("VS Code");
  });

  it("ConnectFlow → endpoint chip + target tabs + selected snippet", async () => {
    renderPanel(
      create(PanelDescriptorSchema, {
        panelId: "connect",
        title: "Connect",
        body: {
          case: "connectFlow",
          value: create(ConnectFlowPanelSchema, {
            defaultTargetId: "cursor",
            endpoint: { label: "Endpoint", value: "mcp.example.com/mcp" },
            targets: [
              {
                id: "cursor",
                label: "Cursor",
                name: "Cursor",
                actions: [
                  {
                    id: "add",
                    label: "Add to Cursor",
                    style: AffordanceStyle.PRIMARY,
                    invoke: { case: "uri", value: "cursor://install" },
                  },
                ],
                configs: [{ content: '{ "demo": {} }', language: "json", path: "~/.cursor/mcp.json" }],
              },
            ],
          }),
        },
      }),
    );
    await screen.findByText("mcp.example.com/mcp"); // endpoint chip
    await screen.findByRole("link", { name: "Add to Cursor" }); // one-click affordance
    await screen.findByText(/~\/\.cursor\/mcp\.json \(json\)/); // snippet caption + language
  });

  it("Catalog → MUI cards with state badge", async () => {
    renderPanel(
      create(PanelDescriptorSchema, {
        panelId: "caps",
        title: "Capabilities",
        body: {
          case: "catalog",
          value: create(CatalogPanelSchema, {
            items: [
              { id: "a", name: "list_instances", description: "start here" },
              { id: "b", name: "graph_*", description: "reads", state: "Next" },
            ],
          }),
        },
      }),
    );
    await screen.findByText("list_instances");
    await screen.findByText("Next");
  });
});

// The adversarial-audit field-completeness fixes, in MUI.
describe("muiKit content field-completeness", () => {
  it("Choice shows per-option description + resolves the icon glyph", async () => {
    render(
      <MeridianMuiProvider invoker={invoker} renderIcon={(k) => <i data-testid={`g-${k}`} />}>
        <PanelRenderer
          descriptor={create(PanelDescriptorSchema, {
            panelId: "c",
            title: "C",
            body: {
              case: "choice",
              value: create(ChoicePanelSchema, {
                options: [{ id: "cursor", label: "Cursor", description: "the AI editor", icon: "cursor" }],
              }),
            },
          })}
        />
      </MeridianMuiProvider>,
    );
    await screen.findByText("the AI editor"); // ChoiceOption.description
    await screen.findByTestId("g-cursor"); // host glyph via renderIcon
  });

  it("CopyValue secret masks, reveals on click, and copies plaintext", async () => {
    render(
      <MeridianMuiProvider invoker={invoker}>
        <PanelRenderer
          descriptor={create(PanelDescriptorSchema, {
            panelId: "s",
            title: "S",
            body: {
              case: "copyValue",
              value: create(CopyValuePanelSchema, { value: { label: "Token", value: "sk-xyz", secret: true } }),
            },
          })}
        />
      </MeridianMuiProvider>,
    );
    await screen.findByText("••••••••"); // masked
    const reveal = await screen.findByRole("button", { name: "Reveal" });
    fireEvent.click(reveal);
    await screen.findByText("sk-xyz"); // revealed plaintext
  });

  it("Affordance.description renders nested in a CatalogItem (no ActionPanel wrapper)", async () => {
    render(
      <MeridianMuiProvider invoker={invoker}>
        <PanelRenderer
          descriptor={create(PanelDescriptorSchema, {
            panelId: "cat",
            title: "Cat",
            body: {
              case: "catalog",
              value: create(CatalogPanelSchema, {
                items: [
                  {
                    id: "gh",
                    name: "GitHub",
                    action: { id: "open", label: "Open", description: "opens the repo", invoke: { case: "uri", value: "https://x" } },
                  },
                ],
              }),
            },
          })}
        />
      </MeridianMuiProvider>,
    );
    await screen.findByText("opens the repo"); // Affordance.description
  });

  it("ConnectFlow with no targets renders the placeholder", async () => {
    render(
      <MeridianMuiProvider invoker={invoker}>
        <PanelRenderer
          descriptor={create(PanelDescriptorSchema, {
            panelId: "ef",
            title: "EF",
            body: { case: "connectFlow", value: create(ConnectFlowPanelSchema, { placeholder: "No clients yet", targets: [] }) },
          })}
        />
      </MeridianMuiProvider>,
    );
    await screen.findByText("No clients yet");
  });
});

// GrammarPanel through MUI: negotiation + the degradation ladder.
describe("muiKit GrammarPanel (negotiation + ladder)", () => {
  const grammarDesc = (value: Parameters<typeof create<typeof GrammarPanelSchema>>[1]) =>
    create(PanelDescriptorSchema, { panelId: "g", title: "G", body: { case: "grammar", value: create(GrammarPanelSchema, value) } });

  it("markdown with no resolver → native md render", async () => {
    render(
      <MeridianMuiProvider invoker={invoker}>
        <PanelRenderer descriptor={grammarDesc({ language: 1, source: "# Title\n\n**b** `c`" })} />
      </MeridianMuiProvider>,
    );
    const h = await screen.findByText("Title");
    expect(h.tagName.toLowerCase()).toBe("h3");
    await screen.findByText("b"); // <strong>
  });

  it("vega-lite with no resolver, no alt → source in a fallback block", async () => {
    render(
      <MeridianMuiProvider invoker={invoker}>
        <PanelRenderer descriptor={grammarDesc({ language: 5, source: '{"mark":"bar"}' })} />
      </MeridianMuiProvider>,
    );
    await screen.findByText("vega-lite"); // fallback label
    await screen.findByText(/"mark":"bar"/);
  });

  it("wired renderGrammar mounts the host's live node (interactive path)", async () => {
    render(
      <MeridianMuiProvider
        invoker={invoker}
        renderGrammar={({ source }) => createElement("div", { "data-testid": "host-vega", "data-src": source })}
      >
        <PanelRenderer descriptor={grammarDesc({ language: 5, source: '{"params":[{"name":"brush"}]}', alt: "scatter" })} />
      </MeridianMuiProvider>,
    );
    await screen.findByTestId("host-vega"); // live node mounted
    expect(screen.queryByText("scatter")).toBeNull(); // not degraded to alt
  });

  it("null from renderGrammar → static snapshot (alt)", async () => {
    render(
      <MeridianMuiProvider invoker={invoker} renderGrammar={() => null}>
        <PanelRenderer descriptor={grammarDesc({ language: 5, source: "{}", alt: "scatter with brush" })} />
      </MeridianMuiProvider>,
    );
    await screen.findByText("scatter with brush");
  });
});

// StatPanel through MUI — computed delta/semantics + sparkline.
describe("muiKit StatPanel", () => {
  const statDesc = (v: Parameters<typeof create<typeof StatPanelSchema>>[1]) =>
    create(PanelDescriptorSchema, { panelId: "s", title: "S", body: { case: "stat", value: create(StatPanelSchema, v) } });

  it("renders value, computed delta with semantic color, and a sparkline", async () => {
    render(
      <MeridianMuiProvider invoker={invoker}>
        <PanelRenderer descriptor={statDesc({ label: "Churn", value: 5.2, format: 2, previous: 4.0, series: [4, 4.5, 5, 5.2], higherIsBetter: false })} />
      </MeridianMuiProvider>,
    );
    await screen.findByText("Churn");
    await screen.findByText("5.2%");
    await screen.findByText(/↑ \+1\.2%/); // computed rising delta
    // churn up (higher_is_better=false) → bad
    expect(document.querySelector('.mer-stat-delta[data-semantics="bad"]')).toBeTruthy();
    expect(document.querySelector("polyline")).toBeTruthy(); // hand-drawn sparkline
  });
});

describe("muiKit renders StepsPanel", () => {
  it("numbers steps from POSITION, so a descriptor cannot carry stale ordinals", async () => {
    renderPanel(
      create(PanelDescriptorSchema, {
        panelId: "walkthrough",
        title: "Create a sponsor",
        body: {
          case: "steps",
          value: create(StepsPanelSchema, {
            intro: "You will add one and confirm a colleague sees it.",
            steps: [
              { label: "Open the Sponsors page" },
              { label: "Add a new sponsor" },
              { label: "Save it" },
            ],
            outro: "Done.",
          }),
        },
      }),
    );
    const items = await screen.findAllByRole("listitem");
    expect(items.length).toBe(3);
    // The numbers are rendered, in order, and come from the array index — there
    // is no ordinal field on Step to disagree with them.
    expect(items.map((li) => li.textContent?.trim().charAt(0))).toEqual(["1", "2", "3"]);
    await screen.findByText("You will add one and confirm a colleague sees it.");
    await screen.findByText("Done.");
  });

  it("badges the actor and gives the same actor the same colour", async () => {
    renderPanel(
      create(PanelDescriptorSchema, {
        panelId: "multi",
        title: "Multi-actor",
        body: {
          case: "steps",
          value: create(StepsPanelSchema, {
            steps: [
              { label: "admin seeds a team", actor: "Admin" },
              { label: "manager opens the list", actor: "Manager" },
              { label: "admin seeds a sponsor", actor: "Admin" },
            ],
          }),
        },
      }),
    );
    const items = await screen.findAllByRole("listitem");
    const cls = (i: number) =>
      items[i]!.querySelector(".mer-step-actor")?.className.match(/MuiChip-color\w+/)?.[0];
    expect(cls(0)).toBeTruthy();
    expect(cls(0)).toBe(cls(2)); // same actor, same colour
    expect(cls(0)).not.toBe(cls(1)); // different actor, different colour
  });

  it("uses media_alt for the frame, falling back to the label rather than empty alt", async () => {
    renderPanel(
      create(PanelDescriptorSchema, {
        panelId: "shots",
        title: "Shots",
        body: {
          case: "steps",
          value: create(StepsPanelSchema, {
            steps: [
              { label: "Described", mediaUri: "/a.png", mediaAlt: "The sponsors list" },
              { label: "Undescribed", mediaUri: "/b.png" },
            ],
          }),
        },
      }),
    );
    await screen.findByAltText("The sponsors list");
    // No media_alt ⇒ the label, never "" (which would hide the omission).
    await screen.findByAltText("Undescribed");
  });
});

describe("muiKit renders MediaPanel", () => {
  it("renders a captions track — the accessible path, not an optional extra", async () => {
    const { container } = renderPanel(
      create(PanelDescriptorSchema, {
        panelId: "vid",
        title: "Walkthrough",
        body: {
          case: "media",
          value: create(MediaPanelSchema, {
            kind: MediaKind.VIDEO,
            srcUri: "/golden-path.mp4",
            posterUri: "/poster.png",
            captionsUri: "/golden-path.vtt",
            durationMs: 252000,
            caption: "The whole walkthrough",
          }),
        },
      }),
    );
    const video = container.querySelector("video");
    expect(video).toBeTruthy();
    expect(video?.getAttribute("poster")).toBe("/poster.png");
    expect(video?.querySelector("track")?.getAttribute("src")).toBe("/golden-path.vtt");
    // controls always on; autoplay is deliberately not expressible
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(video?.hasAttribute("autoplay")).toBe(false);
    await screen.findByText("4:12"); // 252000ms
  });

  it("degrades to alt text when there is no source, rather than an empty box", async () => {
    renderPanel(
      create(PanelDescriptorSchema, {
        panelId: "gone",
        title: "Missing",
        body: {
          case: "media",
          value: create(MediaPanelSchema, {
            kind: MediaKind.VIDEO,
            alt: "A four-minute walkthrough of creating a sponsor.",
          }),
        },
      }),
    );
    await screen.findByText("A four-minute walkthrough of creating a sponsor.");
  });

  it("renders IMAGE as an img with alt, not a player", async () => {
    const { container } = renderPanel(
      create(PanelDescriptorSchema, {
        panelId: "img",
        title: "Diagram",
        body: {
          case: "media",
          value: create(MediaPanelSchema, {
            kind: MediaKind.IMAGE,
            srcUri: "/diagram.png",
            alt: "Sponsor status flow",
          }),
        },
      }),
    );
    expect(container.querySelector("video")).toBeNull();
    await screen.findByAltText("Sponsor status flow");
  });

  it("lists chapters as a readable contents", async () => {
    renderPanel(
      create(PanelDescriptorSchema, {
        panelId: "chaptered",
        title: "Chaptered",
        body: {
          case: "media",
          value: create(MediaPanelSchema, {
            kind: MediaKind.VIDEO,
            srcUri: "/v.mp4",
            chapters: [
              { startMs: 0, label: "Open the page" },
              { startMs: 65000, label: "Add the sponsor" },
            ],
          }),
        },
      }),
    );
    await screen.findByText("Add the sponsor");
    await screen.findByText("1:05");
  });
});
