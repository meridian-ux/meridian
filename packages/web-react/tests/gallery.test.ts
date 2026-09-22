// @vitest-environment jsdom
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { PrincipalDisplay, ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { FIXTURES } from "../../../schemas/conformance/fixtures.js";
import { POPULATED_RESPONSES } from "../../../schemas/conformance/populated.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { MeridianProvider } from "../src/provider.js";
import { PanelRenderer } from "../src/panel_renderer.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe.each([["HTML", htmlKit], ["Shadcn", shadcnKit]] as const)("%s canonical populated table", (_name, kit) => {
  it("renders the canonical populated table in column order", async () => {
    const fixture = FIXTURES.find((candidate) => candidate.shape === "table")!;
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(MeridianProvider, {
        kit, adhoc: {}, resolveHref: (kind, id) => `/${kind}/${id}`, invoker: { invoke: async () => POPULATED_RESPONSES.table },
      }, createElement(PanelRenderer, { descriptor: fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, fixture.descriptor)) }))));
      expect(container.querySelectorAll("th")).toHaveLength(4);
      expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
      expect(container.textContent).toContain("Ada");
      expect(Array.from(container.querySelectorAll("a"), link => link.getAttribute("href"))).toEqual(["/member/Ada", "https://example.com/ada", "/member/Grace"]);
      expect(Array.from(container.querySelectorAll("tbody tr:first-child td"), cell => cell.textContent)).toEqual(["Ada", "0012.50", "Yes", "https://example.com/ada"]);
    } finally { await act(async () => root.unmount()); }
  });

  it("escapes cell markup and rejects executable host destinations", async () => {
    const descriptor = FIXTURES.find(candidate => candidate.shape === "table")!.descriptor;
    const container = document.createElement("div");
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(MeridianProvider, {
        kit, adhoc: {}, resolveHref: () => "javascript:alert(1)",
        invoker: { invoke: async () => ({ claims: [{ member: "<script>bad()</script>", amount: "0012.50" }] }) },
      }, createElement(PanelRenderer, { descriptor }))));
      expect(container.querySelector("tbody td")?.textContent).toBe("<script>bad()</script>");
      expect(container.querySelector("script")).toBeNull();
      expect(container.querySelector("a")).toBeNull();
    } finally { await act(async () => root.unmount()); }
  });

  it("preserves pending, empty, and failed request states", async () => {
    const descriptor = FIXTURES.find(candidate => candidate.shape === "table")!.descriptor;
    const container = document.createElement("div");
    const root = createRoot(container);
    let finish!: (value: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    try {
      await act(async () => root.render(createElement(MeridianProvider, {
        kit, adhoc: {}, invoker: { invoke: async () => pending },
      }, createElement(PanelRenderer, { descriptor }))));
      expect(container.querySelector("table")?.getAttribute("aria-busy")).toBe("true");
      expect(container.textContent).toContain("no claims");
      await act(async () => finish({ claims: [] }));
      expect(container.querySelector("table")?.hasAttribute("aria-busy")).toBe(false);
      expect(container.textContent).toContain("no claims");
      await act(async () => root.render(createElement(MeridianProvider, {
        kit, adhoc: {}, invoker: { invoke: async () => { throw new Error("private details"); } },
      }, createElement(PanelRenderer, { descriptor }))));
      expect(container.textContent).toContain("Failed to load table.");
      expect(container.textContent).not.toContain("private details");
    } finally { await act(async () => root.unmount()); }
  });
});

describe.each([["HTML", htmlKit], ["Shadcn", shadcnKit]] as const)("%s populated gallery", (_name, kit) => {
  async function mount(response: unknown, typed = false, fail = false) {
    const descriptor = create(PanelDescriptorSchema, { panelId: "gallery", body: { case: "gallery", value: {
      populate: { service: "demo.Gallery", method: "List" }, rowsField: "data.items", placeholder: "Nothing here",
      card: { titleField: "name", subtitleField: "owner", statusField: "created", hrefField: "href", imageField: "image", iconField: "icon", actionLabelField: "action",
        ...(typed ? { titleDisplay: { type: ValueType.DATE }, statusDisplay: { type: ValueType.DATE }, subtitleDisplay: {
          type: ValueType.PRINCIPAL, options: { case: "principal" as const, value: { display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE } },
        } } : {}),
      },
    } } });
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(MeridianProvider, { kit, adhoc: {},
      renderIcon: (key) => createElement("b", {}, `glyph:${key}`),
      invoker: { invoke: async () => { if (fail) throw new Error("offline"); return response; } },
    }, createElement(PanelRenderer, { descriptor: fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, descriptor)) }))));
    return { container, close: () => act(async () => root.unmount()) };
  }

  it("formats wire-decoded slots while keeping media and navigation raw", async () => {
    const { container, close } = await mount({ data: { items: [{ name: "2026-03-29", owner: "Ada <ada@example.com>", created: "2026-03-29", href: "/connect/raw-id", image: "/images/demo.png", icon: "cloud", action: "Connect" }] } }, true);
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(1);
    expect(container.querySelector("[data-gallery-title]")?.textContent).toBe("Mar 29, 2026");
    expect(container.querySelector(".mer-gallery-card-subtitle")?.textContent).toBe("Ada");
    expect(container.querySelector(".mer-gallery-card-subtitle")?.getAttribute("title")).toBe("ada@example.com");
    expect(container.querySelector(".mer-gallery-card-status")?.textContent).toBe("Mar 29, 2026");
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("Mar 29, 2026");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/images/demo.png");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/connect/raw-id");
    expect(container.querySelector("a")?.textContent).toBe("Connect");
    expect(container.querySelector('[data-icon="cloud"]')?.textContent).toBe("glyph:cloud");
    await close();
  });

  it("preserves literal slots, escapes markup, and degrades unsafe URLs to text", async () => {
    const { container, close } = await mount({ data: { items: [null, { name: "<script>bad()</script>", owner: "Ada <ada@example.com>", created: false, href: "javascript:bad()", image: "data:image/png;base64,unsafe", action: "Manage" }, { name: "2026-03-29", href: "/safe" }, { name: "Open workspace", href: "vscode://file/project", action: "Open" }] } });
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(3);
    expect(container.querySelector("[data-gallery-title]")?.textContent).toBe("<script>bad()</script>");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector(".mer-gallery-card-subtitle")?.textContent).toBe("Ada <ada@example.com>");
    expect(container.querySelector(".mer-gallery-card-status")?.textContent).toBe("false");
    expect(container.querySelector("img")).toBeNull();
    expect(Array.from(container.querySelectorAll("a"), link => link.getAttribute("href"))).toEqual(["/safe", "vscode://file/project"]);
    expect(container.querySelector(".mer-gallery-card-action")?.textContent).toBe("Manage");
    await close();
  });

  it("handles malformed rows and failed requests", async () => {
    const empty = await mount({ data: { items: { invalid: true } } });
    expect(empty.container.textContent).toContain("Nothing here");
    await empty.close();
    const failed = await mount(undefined, false, true);
    expect(failed.container.textContent).toContain("Failed to load gallery.");
    await failed.close();
  });

  it("renders the canonical populated gallery descriptor", async () => {
    const fixture = FIXTURES.find((candidate) => candidate.shape === "gallery")!;
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => root.render(createElement(MeridianProvider, {
      kit,
      adhoc: {},
      invoker: { invoke: async () => POPULATED_RESPONSES.gallery },
    }, createElement(PanelRenderer, {
      descriptor: fromBinary(PanelDescriptorSchema, toBinary(PanelDescriptorSchema, fixture.descriptor)),
    }))));
    expect(container.querySelectorAll("[data-gallery-card]")).toHaveLength(2);
    expect(container.textContent).toContain("GitHub");
    expect(container.textContent).toContain("PagerDuty");
    expect(container.querySelectorAll("[data-gallery-link]")).toHaveLength(2);
    await act(async () => root.unmount());
  });
});
