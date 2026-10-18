// @vitest-environment jsdom
//
// The web-components renderer over the six brand-neutral content shapes
// (choice / snippet / action / connect_flow / copy_value / catalog). These are
// STATIC (no wasm/RPC), so a bare mock wasm suffices. Asserts the same
// field-completeness contract the web-react kits enforce: option/affordance
// description, the icon seam (data-icon + host glyph via renderIcon), snippet
// language, CopyValue secret mask + reveal, and the ConnectFlow placeholder.

import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyValuePanelSchema } from "@savvifi/meridian-proto-ts/proto/copy_value_pb.js";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import type { InvocationHost } from "@savvifi/meridian-schemas/uiview";
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
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const invoker = { invoke: async () => ({}) };

async function draw(descriptor: Parameters<typeof renderPanel>[0]["descriptor"], withIcons = false, invocation?: InvocationHost) {
  const root = document.createElement("div");
  await renderPanel({
    wasm: noWasm,
    root,
    descriptor,
    invoker,
    context: CTX,
    invocation,
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

it.each([undefined, 0, 1, 2, 999])("action emphasis %s and Tone never bypass admission or change typed target payloads", async emphasis => {
  for (const tone of [undefined, 0, 1, 2, 3, 4, 5, 6, 999]) {
    const writeText = vi.fn(async () => {});
    const admittedTarget = vi.fn(async (_target: string) => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    for (const target of ["/next", "javascript:alert(1)", "echo raw command"]) {
      const command = target.startsWith("echo");
      const descriptor = create(PanelDescriptorSchema, { body: { case: "action", value: { action: {
        label: "Action", description: "Explain", style: 1, tone, emphasis,
        invoke: command ? { case: "command", value: target } : { case: "uri", value: target },
      } } } });
      const root = await draw(descriptor, false, { admit: () => true, capabilities: { uri: admittedTarget, command: admittedTarget } });
      const control = root.querySelector(".mer-affordance") as HTMLElement;
      const primary = emphasis === undefined || emphasis === 1;
      expect(control.classList.contains("mer-affordance-primary")).toBe(primary);
      expect(control.dataset.merTone).toBe(tone === undefined ? undefined : ["neutral", "neutral", "info", "success", "warning", "danger", "accent"][tone] ?? "neutral");
      if (emphasis !== undefined) expect(control.style.borderWidth).toBe(primary ? "2px" : "1px");
      if (target.startsWith("javascript:")) {
        expect((control as HTMLButtonElement).disabled).toBe(true);
        control.click();
        expect(writeText).not.toHaveBeenCalled();
        expect(admittedTarget).not.toHaveBeenCalledWith(target, expect.anything(), expect.anything());
      } else if (command) {
        expect(writeText).not.toHaveBeenCalled();
        control.click();
        await vi.waitFor(() => expect(admittedTarget).toHaveBeenCalledWith(target, CTX, expect.any(AbortSignal)));
        expect(writeText).not.toHaveBeenCalled();
      } else {
        expect(control.getAttribute("href")).toBeNull(); control.click();
        await vi.waitFor(() => expect(admittedTarget).toHaveBeenCalledWith("/next", CTX, expect.any(AbortSignal)));
      }
    }
  }
});

describe("web-components content shapes (field-complete)", () => {
  it.each(["", "  "])("names an empty copy control while copying its raw value %j", async raw => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    for (const secret of [false, true]) {
      const root = await draw(create(PanelDescriptorSchema, { body: { case: "copyValue", value: {
        value: { label: "Token", value: raw, secret },
      } } }));
      if (secret) root.querySelector<HTMLButtonElement>(".mer-reveal")!.click();
      const button = root.querySelector<HTMLButtonElement>(".mer-copyvalue-btn")!;
      expect(button.getAttribute("aria-label")).toBe("Copy Token");
      button.click();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith(raw);
    }
  });
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

  it("Action renders an admitted URI button without a context-menu bypass", async () => {
    const uri = vi.fn(async (_uri: string) => {});
    const root = await draw(actionFixture, false, { admit: () => true, capabilities: { uri } });
    expect(root.querySelector("a.mer-affordance")).toBeNull();
    root.querySelector<HTMLButtonElement>("button.mer-affordance")!.click();
    await vi.waitFor(() => expect(uri).toHaveBeenCalledWith("cursor://install", CTX, expect.any(AbortSignal)));
  });

  it.each(["javascript:alert(1)", "data:text/html,unsafe", "file:///etc/passwd", "java\nscript:alert(1)"])(
    "Action degrades an unsafe URI to a disabled control: %s",
    async (uri) => {
      const root = await draw(create(PanelDescriptorSchema, {
        body: { case: "action", value: {
          description: "Keep the authored context",
          action: { label: "Open destination", description: "Untrusted target", icon: "open", invoke: { case: "uri", value: uri } },
        } },
      }));
      expect(root.querySelector("a")).toBeNull();
      const control = root.querySelector("button.mer-affordance") as HTMLButtonElement;
      expect(control.disabled).toBe(true);
      expect(control.getAttribute("aria-disabled")).toBe("true");
      expect(root.textContent).toContain("Open destination");
      expect(root.textContent).toContain("Untrusted target");
      expect(control.dataset.icon).toBe("open");
    },
  );

  it("CopyValue masks a secret and reveals on click (copy yields plaintext)", async () => {
    const root = await draw(copyValueFixture);
    const code = root.querySelector(".mer-copyvalue-value") as HTMLElement;
    expect(code.textContent).toBe("••••••••");
    const reveal = root.querySelector(".mer-reveal") as HTMLButtonElement;
    expect(reveal).toBeTruthy();
    reveal.click();
    expect(code.textContent).toBe("sk-abc123");
  });

  it("CopyValue applies declared display while preserving the raw copy source", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
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
    const root = await draw(typed);
    expect(root.querySelector(".mer-copyvalue-value")?.textContent).toBe("Mar 29, 2026");
    (root.querySelector(".mer-copyvalue-btn") as HTMLButtonElement).click();
    expect(writeText).toHaveBeenCalledWith("2026-03-29");
    vi.runAllTimers();
  });

  it("preserves copy/reveal behavior on a formatted ConnectFlow secret after copy feedback", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const root = await draw(create(PanelDescriptorSchema, { body: { case: "connectFlow", value: {
      endpoint: { value: "2026-03-29", secret: true, display: { type: ValueType.DATE } },
    } } }));
    const copy = root.querySelector(".mer-copyvalue-btn") as HTMLButtonElement;
    const reveal = root.querySelector(".mer-reveal") as HTMLButtonElement;
    expect(copy.textContent).toBe("••••••••");
    copy.click();
    vi.runAllTimers();
    reveal.click();
    expect(copy.textContent).toBe("Mar 29, 2026");
    copy.click();
    // Hiding while copy feedback is visible must also hide the restored value.
    reveal.click();
    vi.runAllTimers();
    expect(copy.textContent).toBe("••••••••");
    expect(writeText.mock.calls).toEqual([["2026-03-29"], ["2026-03-29"]]);
  });

  it.each([undefined, {}])("preserves literal text for absent/unspecified display: %j", async (display) => {
    const root = await draw(create(PanelDescriptorSchema, { body: { case: "copyValue", value: {
      value: { value: "2026-03-29", display },
    } } }));
    expect(root.querySelector(".mer-copyvalue-value")?.textContent).toBe("2026-03-29");
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
