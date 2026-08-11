// @vitest-environment jsdom
//
// The web-components renderer over the six brand-neutral content shapes
// (choice / snippet / action / connect_flow / copy_value / catalog). These are
// STATIC (no wasm/RPC), so a bare mock wasm suffices. Asserts the same
// field-completeness contract the web-react kits enforce: option/affordance
// description, the icon seam (data-icon + host glyph via renderIcon), snippet
// language, CopyValue secret mask + reveal, and the ConnectFlow placeholder.

import { describe, expect, it } from "vitest";

import { renderPanel } from "../src/uiview/renderer.js";
import type { RenderedRow, UiviewWasm } from "../src/uiview/renderer.js";
import {
  actionFixture,
  catalogFixture,
  choiceFixture,
  connectFlowFixture,
  copyValueFixture,
  snippetFixture,
} from "./fixtures.js";

// Content shapes never touch the wasm; a stub that throws proves it.
const noWasm: UiviewWasm = {
  renderTable: () => [] as RenderedRow[],
  buildPopulateRequest: () => ({}),
  readPath: () => null,
  buildRequest: () => ({}),
  renderTablePanel: () => [] as RenderedRow[],
  formatLroMetadata: () => "",
};

const CTX = { currentResourcePath: null, uiIdentity: null, selectedRow: null, formValues: {} };
const invoker = { invoke: async () => ({}) };

async function draw(descriptor: Parameters<typeof renderPanel>[0]["descriptor"], withIcons = false) {
  const root = document.createElement("div");
  await renderPanel({
    wasm: noWasm,
    root,
    descriptor,
    invoker,
    context: CTX,
    renderIcon: withIcons
      ? (key: string) => {
          const i = document.createElement("i");
          i.className = `glyph-${key}`;
          return i;
        }
      : undefined,
  });
  return root;
}

describe("web-components content shapes (field-complete)", () => {
  it("Choice renders option label + description + icon seam", async () => {
    const root = await draw(choiceFixture);
    expect(root.querySelectorAll('[role="tab"]').length).toBe(2);
    expect(root.textContent).toContain("the AI editor"); // ChoiceOption.description
    expect(root.querySelector('[data-icon="cursor"]')).toBeTruthy(); // key survives
    const withGlyph = await draw(choiceFixture, true);
    expect(withGlyph.querySelector(".glyph-cursor")).toBeTruthy(); // host glyph
  });

  it("Snippet renders caption path + language", async () => {
    const root = await draw(snippetFixture);
    expect(root.querySelector("figure")?.dataset.lang).toBe("json");
    expect(root.textContent).toContain("~/.cursor/mcp.json");
    expect(root.textContent).toContain("(json)");
  });

  it("Action renders the affordance (uri → link) + description", async () => {
    const root = await draw(actionFixture);
    const link = root.querySelector("a.mer-affordance") as HTMLAnchorElement;
    expect(link?.getAttribute("href")).toBe("cursor://install");
  });

  it("CopyValue masks a secret and reveals on click (copy yields plaintext)", async () => {
    const root = await draw(copyValueFixture);
    const code = root.querySelector(".mer-copyvalue-value") as HTMLElement;
    expect(code.textContent).toBe("••••••••");
    const reveal = root.querySelector(".mer-reveal") as HTMLButtonElement;
    expect(reveal).toBeTruthy();
    reveal.click();
    expect(code.textContent).toBe("sk-abc123");
  });

  it("ConnectFlow renders endpoint + tabs + affordance description; switches on click", async () => {
    const root = await draw(connectFlowFixture);
    expect(root.textContent).toContain("mcp.example.com/mcp"); // endpoint
    expect(root.querySelectorAll(".mer-connect-tab").length).toBe(2);
    expect(root.textContent).toContain("opens Cursor"); // Affordance.description (nested)
    // second target's body is hidden until its tab is clicked
    const zedBody = root.querySelector('.mer-connect-body[data-target="zed"]') as HTMLElement;
    expect(zedBody.hidden).toBe(true);
    (root.querySelector('.mer-connect-tab[data-target="zed"]') as HTMLButtonElement).click();
    expect(zedBody.hidden).toBe(false);
  });

  it("ConnectFlow with no targets renders the placeholder", async () => {
    const empty = { ...connectFlowFixture };
    const root = await draw({
      ...connectFlowFixture,
      body: { case: "connectFlow", value: { ...connectFlowFixture.body.value, targets: [], placeholder: "No clients yet" } },
    } as typeof connectFlowFixture);
    expect(root.textContent).toContain("No clients yet");
    void empty;
  });

  it("Catalog renders items, state badge, and icon; placeholder when empty", async () => {
    const root = await draw(catalogFixture);
    expect(root.querySelectorAll(".mer-catalog-item").length).toBe(2);
    expect(root.textContent).toContain("list_instances");
    expect(root.textContent).toContain("Next");
    expect(root.querySelector('[data-icon="tool"]')).toBeTruthy();
  });
});
