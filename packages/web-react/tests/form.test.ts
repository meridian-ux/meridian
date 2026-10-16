// @vitest-environment jsdom
import { create, fromBinary, fromJson, toBinary, type JsonObject } from "@bufbuild/protobuf";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { FormPanelSchema, PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { EnumSelectionSchema, FormFieldSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { FieldBindingSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { ValueType, ValueTone } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { normalizeDom } from "../../../schemas/conformance/normalize_dom.js";
import { htmlKit } from "../src/html_kit.js";
import { shadcnKit } from "../src/shadcn_kit.js";
import { MeridianProvider } from "../src/provider.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe.each([["HTML", htmlKit], ["Shadcn", shadcnKit]] as const)("%s form transport", (_, kit) => {
  const panel = () => create(FormPanelSchema, { mode: 2, itemNoun: "record", submit: {
    service: "demo.Records", method: "Update", bindings: [{ requestField: "scope", source: { case: "literal", value: "scope-1" } }],
  }, fields: [
    { fieldId: "name", requestField: "legacy.name", label: "Name", kind: { case: "text", value: { defaultValue: "Ada", minLength: 2 } } },
    { fieldId: "count", label: "Count", kind: { case: "integer", value: { defaultValue: 2 } } },
    { fieldId: "enabled", label: "Enabled", kind: { case: "boolean", value: { defaultValue: true } } },
  ] });
  async function mount(p: ReturnType<typeof panel>, invoke: (...args: any[]) => Promise<any>, allowed = true) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke },
      admission: { mutations: allowed ? ["demo.Records/Update"] : [] }, children: createElement(kit.Form, {
        descriptor: create(PanelDescriptorSchema, { body: { case: "form", value: p } }), panel: p, invoker: { invoke } }) })));
    return { container, close: async () => { await act(async () => root.unmount()); container.remove(); } };
  }
  const submit = (container: HTMLElement) => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  it("shares the submit budget across bindings and typed values, retaining input for a smaller retry", async () => {
    const p = panel();
    p.submit!.bindings[0].source = { case: "literal", value: "s".repeat(400_000) };
    const invoke = vi.fn(async (_s: string, _m: string, _request: object) => ({}));
    const view = await mount(p, invoke);
    try {
      const input = view.container.querySelector<HTMLInputElement>('input[name="legacy.name"]')!;
      input.value = "v".repeat(400_000);
      await act(async () => { submit(view.container); });
      expect(invoke).not.toHaveBeenCalled();
      expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("Request construction rejected");
      expect(input.value).toHaveLength(400_000);
      input.value = "smaller";
      await act(async () => { submit(view.container); });
      expect(invoke).toHaveBeenCalledOnce();
      expect(invoke.mock.calls[0][2]).toMatchObject({ name: "smaller", count: 2, enabled: true });
      expect(view.container.querySelector('[role="alert"]')).toBeNull();
    } finally { await view.close(); }
  });

  it("uses explicit binding precedence and declared formField sources without changing the entered value", async () => {
    const p = panel();
    p.submit!.bindings.push(...[
      { requestField: "name", source: { case: "literal" as const, value: "bound" } },
      { requestField: "copy", source: { case: "formField" as const, value: "name" } },
      { requestField: "hidden", source: { case: "formField" as const, value: "secret" } },
    ].map(binding => create(FieldBindingSchema, binding)));
    const invoke = vi.fn(async (_s: string, _m: string, _request: object) => ({}));
    const view = await mount(p, invoke);
    try {
      await act(async () => { submit(view.container); });
      expect(invoke.mock.calls[0][2]).toEqual({ scope: "scope-1", name: "bound", copy: "Ada", count: 2, enabled: true });
      expect(view.container.querySelector<HTMLInputElement>('input[name="legacy.name"]')!.value).toBe("Ada");
    } finally { await view.close(); }
  });

  it("maps nested LRO paths after bindings and preserves raw false, zero, and strings", async () => {
    const descriptor = create(PanelDescriptorSchema, { body: { case: "lro", value: {
      start: { service: "demo.Inputs", method: "Start", bindings: [
        { requestField: "request.name", source: { case: "literal", value: "bound" } },
        { requestField: "copy", source: { case: "formField", value: "name" } },
      ] }, inputs: [
        { fieldId: "name", requestField: "request.name", kind: { case: "text", value: { defaultValue: "001.20" } } },
        { fieldId: "count", requestField: "counter.count", kind: { case: "integer", value: { defaultValue: 0 } } },
        { fieldId: "outer", requestField: "config", kind: { case: "nested", value: { fields: [
          { fieldId: "flag", requestField: "data.flag", kind: { case: "boolean", value: { defaultValue: false } } },
        ] } } },
      ],
    } } });
    if (descriptor.body.case !== "lro") throw new Error("Wrong fixture arm");
    const invoke = vi.fn(async (_s: string, _m: string, _request: object) => ({ done: true, response: {} }));
    const container = document.createElement("div"); const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(MeridianProvider, { kit, adhoc: {}, invoker: { invoke }, admission: { mutations: ["demo.Inputs/Start"] },
        children: createElement(kit.Lro, { descriptor, panel: descriptor.body.value, invoker: { invoke } }) })));
      await act(async () => { submit(container); });
      expect(invoke).toHaveBeenCalledWith("demo.Inputs", "Start", { request: { name: "001.20" }, copy: "001.20", counter: { count: 0 }, config: { data: { flag: false } } });
      expect(container.textContent).toContain("Done.");
    } finally { await act(async () => root.unmount()); }
  });
  it("admits valid nested forms despite protobuf structural wrapper depth", async () => {
    const p = panel();
    let field = create(FormFieldSchema, { fieldId: "leaf", kind: { case: "text", value: { defaultValue: "Deep value" } } });
    for (let i = 0; i < 20; i++) field = create(FormFieldSchema, { fieldId: `group${i}`, kind: { case: "nested", value: { fields: [field] } } });
    p.fields = [field];
    const view = await mount(p, vi.fn(async () => ({})));
    try {
      expect(view.container.querySelector<HTMLInputElement>("input")?.value).toBe("Deep value");
      expect(view.container.querySelector('[role="alert"]')).toBeNull();
    } finally { await view.close(); }
  });
  it.each(["unsafe", "large", "cycle"])("rejects %s prefill requests visibly without transport or field mounting", async mode => {
    const p = panel();
    const field = create(FieldBindingSchema, { requestField: mode === "unsafe" ? "__proto__.scope" : "payload",
      source: mode === "cycle" ? { case: "nested", value: {} } : { case: "literal", value: "x".repeat(mode === "large" ? 800_000 : 1) } });
    if (field.source.case === "nested") field.source.value.fields.push(field);
    p.prefill = create(FormPanelSchema, { prefill: { service: "demo.Records", method: "Get", bindings: [field] } }).prefill;
    const invoke = vi.fn(async () => ({}));
    const view = await mount(p, invoke);
    try {
      expect(invoke).not.toHaveBeenCalled();
      expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("rejected");
      expect(view.container.querySelectorAll("input,select,textarea")).toHaveLength(0);
    } finally { await view.close(); }
  });
  it.each([0, 1])("uses runtime rows rather than a descriptor row-count alias (minimum %i)", async minItems => {
    const p = panel(); p.fields = [
      fromJson(FormFieldSchema, { fieldId: "collision", requestField: "items.__count", text: { defaultValue: "4294967295" } }),
      fromJson(FormFieldSchema, { fieldId: "items", repeated: { minItems, scalar: { fieldId: "item", text: { defaultValue: "row" } } } }),
    ];
    const invoke = vi.fn(async () => ({})), view = await mount(p, invoke);
    const nativeFrom = Array.from;
    const allocation = vi.spyOn(Array, "from").mockImplementation((source: any, map?: any, receiver?: any) => {
      if (source && !source[Symbol.iterator] && source.length > 1000) throw new Error("unbounded allocation sentinel");
      return nativeFrom(source, map, receiver);
    });
    try {
      expect(new FormData(view.container.querySelector("form")!).getAll("items.__count")).toHaveLength(minItems ? 2 : 1);
      await act(async () => { submit(view.container); });
      expect(view.container.querySelector('[role="alert"]')).toBeNull();
      expect(invoke).toHaveBeenCalledWith("demo.Records", "Update", { scope: "scope-1", collision: "4294967295", items: minItems ? ["row"] : [] });
    } finally { allocation.mockRestore(); await view.close(); }
  });
  it("keeps nested row counts correct after add, move, remove, and advisory-count tampering", async () => {
    const p = panel(); p.fields = [fromJson(FormFieldSchema, { fieldId: "rows", repeated: { minItems: 2, addLabel: "Add outer",
      object: { fields: [{ fieldId: "items", repeated: { minItems: 1, addLabel: "Add inner", scalar: { text: { defaultValue: "row" } } } }] } } })];
    const invoke = vi.fn(async () => ({})), view = await mount(p, invoke);
    try {
      const inner = () => [...view.container.querySelectorAll("button")].filter(button => button.textContent === "Add inner");
      await act(async () => inner()[1].click());
      await act(async () => inner()[1].click());
      await act(async () => [...view.container.querySelectorAll("button")].find(button => button.textContent === "Add outer")!.click());
      const outer = view.container.querySelector('[data-min="2"]')!;
      await act(async () => outer.querySelectorAll<HTMLButtonElement>(':scope > ol > li > div > button[aria-label="Move up"]')[2].click());
      await act(async () => outer.querySelector<HTMLButtonElement>(':scope > ol > li > div > button[aria-label="Remove"]')!.click());
      for (const input of view.container.querySelectorAll<HTMLInputElement>('input[type="hidden"][name$=".__count"]')) input.value = "4294967295";
      const nativeFrom = Array.from;
      const allocation = vi.spyOn(Array, "from").mockImplementation((source: any, map?: any, receiver?: any) => {
        if (source && !source[Symbol.iterator] && source.length > 1000) throw new Error("unbounded allocation sentinel");
        return nativeFrom(source, map, receiver);
      });
      try { await act(async () => { submit(view.container); }); }
      finally { allocation.mockRestore(); }
      expect(view.container.querySelector('[role="alert"]')).toBeNull();
      expect(invoke).toHaveBeenCalledWith("demo.Records", "Update", { scope: "scope-1", rows: [{ items: ["row"] }, { items: ["row", "row", "row"] }] });
    } finally { await view.close(); }
  });
  const kinds: Record<string, JsonObject> = { integer: {}, number: {}, boolean: {}, text: {}, masked: {},
    enumSelection: { allowedValues: ["one"], defaultValue: "one" }, nested: {},
    repeated: { scalar: { fieldId: "item", text: {} } }, keyValueMap: {} };
  it.each(Object.keys(kinds))("rejects an empty object-field ID for %s before transport", async kind => {
    const p = panel();
    p.fields = [fromJson(FormFieldSchema, { label: "Missing identity", [kind]: kinds[kind] })];
    const invoke = vi.fn(async () => ({}));
    const view = await mount(fromBinary(FormPanelSchema, toBinary(FormPanelSchema, p)), invoke);
    try {
      await act(async () => { submit(view.container); });
      expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("nonempty");
      expect(invoke).not.toHaveBeenCalled();
    } finally { await view.close(); }
  });
  it.each(["root", "nested", "repeated"])("rejects duplicate field IDs at the %s object boundary", async shape => {
    const p = panel();
    const duplicate = [{ fieldId: "same", text: {} }, { fieldId: "same", text: {} }];
    p.fields = (shape === "root" ? duplicate : [{ fieldId: "outer", ...(shape === "nested"
      ? { nested: { fields: duplicate } } : { repeated: { minItems: 1, object: { fields: duplicate } } }) }])
      .map(field => fromJson(FormFieldSchema, field));
    const invoke = vi.fn(async () => ({}));
    const view = await mount(p, invoke);
    try {
      await act(async () => { submit(view.container); });
      expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("unique");
      expect(invoke).not.toHaveBeenCalled();
    } finally { await view.close(); }
  });
  it("reports malformed patterns through shared validation without invoking", async () => {
    const p = panel(); p.fields = [fromJson(FormFieldSchema, { fieldId: "value", text: { defaultValue: "raw", pattern: "[" } })];
    const invoke = vi.fn(async () => ({})); const view = await mount(p, invoke);
    try {
      await act(async () => { submit(view.container); });
      expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("invalid pattern");
      expect(invoke).not.toHaveBeenCalled();
    } finally { await view.close(); }
  });
  const enumPanel = () => create(FormPanelSchema, { mode: 2,
    submit: { service: "demo.Records", method: "Update" }, fields: [
      { fieldId: "region", label: "Region", kind: { case: "enumSelection", value: {
        defaultValue: "west", optionsSource: { service: "demo.Options", method: "List", optionsField: "outer.items", valueField: "id", labelField: "display.label" },
      } } },
    ] });
  it.each(["nested", "scalar-list", "object-list"])("keeps loaded enum membership authoritative inside %s", async shape => {
    const p = enumPanel(), option = p.fields[0]; option.requestField = "config.region";
    p.fields = [create(FormFieldSchema, { fieldId: "outer", requestField: "settings", kind: shape === "nested"
      ? { case: "nested", value: { fields: [option] } }
      : { case: "repeated", value: { minItems: 1, element: shape === "scalar-list"
        ? { case: "scalar", value: option } : { case: "object", value: { fields: [option] } } } } })];
    const invoke = vi.fn(async (_service: string, method: string) => method === "List"
      ? { outer: { items: [{ id: "west", display: { label: "Western region" } }] } } : {});
    const view = await mount(p, invoke);
    try {
      const select = view.container.querySelector("select")!;
      expect(select.disabled).toBe(false);
      const forged = document.createElement("option"); forged.value = "forged"; select.append(forged); select.value = "forged";
      await act(async () => { submit(view.container); });
      expect(invoke.mock.calls.some(([, method]) => method === "Update")).toBe(false);
      expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("select an allowed value");
      select.value = "west";
      await act(async () => { submit(view.container); });
      const value = shape === "nested" ? { region: "west" } : shape === "scalar-list" ? ["west"] : [{ region: "west" }];
      expect(invoke).toHaveBeenCalledWith("demo.Records", "Update", { outer: value });
    } finally { await view.close(); }
  });
  it("loads read-tier options after prefill and submits only resolved tokens", async () => {
    const p = enumPanel();
    p.prefill = create(FormPanelSchema, { prefill: { service: "demo.Records", method: "Get" } }).prefill;
    let finish!: (value: unknown) => void;
    const invoke = vi.fn(async (_s: string, method: string) => method === "Get" ? { region: "east" } : method === "List"
      ? new Promise(resolve => { finish = resolve; }) : {});
    const view = await mount(p, invoke);
    try {
      expect(invoke.mock.calls).toEqual([["demo.Records", "Get", {}], ["demo.Options", "List", {}]]);
      expect(view.container.querySelector("select")!.disabled).toBe(true);
      expect(view.container.textContent).toContain("Loading options");
      expect(normalizeDom(view.container)).toMatchSnapshot("enum options loading");
      await act(async () => { submit(view.container); });
      expect(invoke).toHaveBeenCalledTimes(2);
      await act(async () => finish({ outer: { items: [
        { id: "west", display: { label: "West" } }, { id: "east", display: { label: "<b>East</b>" } },
      ] } }));
      const select = view.container.querySelector("select")!;
      expect(select.value).toBe("east");
      expect(select.hasAttribute("data-value-tone")).toBe(false);
      expect(select.textContent).toContain("<b>East</b>");
      expect(select.querySelector("b")).toBeNull();
      expect(normalizeDom(view.container)).toMatchSnapshot("enum options resolved after blocked submit");
      await act(async () => { submit(view.container); });
      expect(invoke.mock.calls[2]).toEqual(["demo.Records", "Update", { region: "east" }]);
      select.add(new Option("Forged", "forged")); select.value = "forged";
      await act(async () => { submit(view.container); });
      expect(invoke).toHaveBeenCalledTimes(3);
      expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("select an allowed value");
    } finally { await view.close(); }
  });
  it("keeps failed and malformed dynamic option sources unavailable", async () => {
    for (const [state, response] of [
      ["failed", undefined], ["malformed", { outer: { items: "invalid" } }], ["empty", { outer: { items: [] } }],
    ] as const) {
      const invoke = vi.fn(async () => { if (!response) throw new Error("<img> offline"); return response; });
      const view = await mount(enumPanel(), invoke);
      try {
        expect(view.container.querySelector("select")!.disabled).toBe(true);
        expect(view.container.querySelector("img")).toBeNull();
        expect(view.container.querySelector('[role="alert"], [role="status"]')).not.toBeNull();
        expect(normalizeDom(view.container)).toMatchSnapshot(`enum options ${state}`);
        await act(async () => { submit(view.container); });
        expect(invoke.mock.calls).toEqual([["demo.Options", "List", {}]]);
      } finally { await view.close(); }
    }
  });
  it("preserves static options and honors labeled option precedence without reads", async () => {
    for (const labeled of [false, true]) {
      const p = enumPanel(); const kind = p.fields[0].kind;
      if (kind.case !== "enumSelection") throw new Error("expected enum");
      kind.value.optionsSource = undefined;
      kind.value.allowedValues = ["west", "east"];
      if (labeled) kind.value.options = create(EnumSelectionSchema, {
        options: [{ value: "west", label: "Western region" }],
      }).options;
      const invoke = vi.fn(async () => ({})); const view = await mount(p, invoke);
      try {
        expect(invoke).not.toHaveBeenCalled();
        expect(view.container.querySelector("select")!.value).toBe("west");
        expect(view.container.querySelectorAll("option")).toHaveLength(labeled ? 1 : 2);
        await act(async () => { submit(view.container); });
        expect(invoke.mock.calls).toEqual([["demo.Records", "Update", { region: "west" }]]);
      } finally { await view.close(); }
    }
  });
  it("preserves option tones and updates selected metadata without changing submitted tokens", async () => {
    const p = enumPanel();
    const kind = p.fields[0].kind;
    if (kind.case !== "enumSelection") throw new Error();
    kind.value.optionsSource = undefined;
    kind.value.options = create(EnumSelectionSchema, { options: [
      { value: "west", label: "Western region", tone: 3 },
      { value: "east", label: "", tone: 5 },
      { value: "other", tone: 99 as ValueTone },
    ] }).options;
    const invoke = vi.fn(async () => ({})); const view = await mount(p, invoke);
    try {
      const select = view.container.querySelector("select")!;
      expect(select.dataset.valueTone).toBe("success");
      expect(select.selectedOptions[0].textContent).toBe("Western region");
      expect(Array.from(select.options, option => option.dataset.valueTone)).toEqual(["success", "danger", undefined]);
      await act(async () => { select.value = "east"; select.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(select.dataset.valueTone).toBe("danger");
      expect(select.selectedOptions[0].textContent).toBe("east");
      await act(async () => { submit(view.container); });
      expect(invoke.mock.calls.at(-1)).toEqual(["demo.Records", "Update", { region: "east" }]);
      await act(async () => { select.value = "other"; select.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(select.hasAttribute("data-value-tone")).toBe(false);
    } finally { await view.close(); }
  });
  it("validates dynamic enums in nested and repeated field paths", async () => {
    const p = enumPanel(); const field = p.fields[0];
    p.fields = create(FormPanelSchema, { fields: [
      { fieldId: "settings", kind: { case: "nested", value: { fields: [field] } } },
      { fieldId: "regions", kind: { case: "repeated", value: { minItems: 1, element: { case: "scalar", value: field } } } },
    ] }).fields;
    const invoke = vi.fn(async (_s: string, method: string) => method === "List"
      ? { outer: { items: [{ id: "west", display: { label: "West" } }] } } : {});
    const view = await mount(p, invoke);
    try {
      await act(async () => { submit(view.container); });
      expect(invoke.mock.calls.at(-1)).toEqual(["demo.Records", "Update", { settings: { region: "west" }, regions: ["west"] }]);
    } finally { await view.close(); }
  });
  it("submits typed raw values with bindings, blocks duplicate requests, and reports success", async () => {
    let finish!: (value: unknown) => void;
    const invoke = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const view = await mount(panel(), invoke);
    try {
      await act(async () => { submit(view.container); submit(view.container); });
      expect(invoke.mock.calls).toEqual([["demo.Records", "Update", { scope: "scope-1", name: "Ada", count: 2, enabled: true }]]);
      expect(view.container.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled).toBe(true);
      expect(normalizeDom(view.container)).toMatchSnapshot("form saving");
      await act(async () => finish({}));
      expect(view.container.textContent).toContain("Saved.");
      expect(normalizeDom(view.container)).toMatchSnapshot("form saved");
    } finally { await view.close(); }
  });
  it("blocks invalid and denied submits without invoking transport", async () => {
    const invoke = vi.fn(async () => ({}));
    const view = await mount(panel(), invoke);
    try {
      view.container.querySelector<HTMLInputElement>("input")!.value = "";
      await act(async () => { submit(view.container); });
      expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("invalid length");
      expect(invoke).not.toHaveBeenCalled();
    } finally { await view.close(); }
    const denied = await mount(panel(), invoke, false);
    try {
      expect(denied.container.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
      await act(async () => { submit(denied.container); });
      expect(invoke).not.toHaveBeenCalled();
    } finally { await denied.close(); }
  });
  it("prefills through reads, retains typed values, escapes failures and permits retry", async () => {
    const p = panel(); p.prefill = create(FormPanelSchema, { prefill: { service: "demo.Records", method: "Get" } }).prefill;
    let failed = false;
    const invoke = vi.fn(async (_service: string, method: string) => {
      if (method === "Get") return { name: "<b>Ada</b>", count: 7, enabled: false };
      if (!failed) { failed = true; throw new Error("<img src=x> failed"); }
      return {};
    });
    const view = await mount(p, invoke);
    try {
      expect(view.container.querySelector<HTMLInputElement>("input")!.value).toBe("<b>Ada</b>");
      await act(async () => { submit(view.container); });
      expect(invoke.mock.calls[1]).toEqual(["demo.Records", "Update", { scope: "scope-1", name: "<b>Ada</b>", count: 7, enabled: false }]);
      expect(view.container.querySelector('[role="alert"]')?.textContent).toBe("<img src=x> failed");
      expect(view.container.querySelector("img")).toBeNull();
      expect(normalizeDom(view.container)).toMatchSnapshot("form submit failed with prefilled values");
      await act(async () => { submit(view.container); });
      expect(view.container.textContent).toContain("Saved.");
      expect(normalizeDom(view.container)).toMatchSnapshot("form retry saved with prefilled values");
    } finally { await view.close(); }
  });
  it("prefills and submits nested objects, repeated scalars, and string maps", async () => {
    const p = create(FormPanelSchema, { mode: 2, prefill: { service: "demo.Records", method: "Get" },
      submit: { service: "demo.Records", method: "Update" }, fields: [
        { fieldId: "profile", kind: { case: "nested", value: { fields: [
          { fieldId: "name", label: "Name", kind: { case: "text", value: {} } },
        ] } } },
        { fieldId: "tags", kind: { case: "repeated", value: { element: { case: "scalar", value: { kind: { case: "text", value: {} } } } } } },
        { fieldId: "labels", kind: { case: "keyValueMap", value: {} } },
      ] });
    const values = { profile: { name: "Ada" }, tags: ["one", "two"], labels: { team: "math" } };
    const invoke = vi.fn(async (_s: string, method: string) => method === "Get" ? values : {});
    const view = await mount(p, invoke);
    try {
      await act(async () => { submit(view.container); });
      expect(invoke.mock.calls[1]).toEqual(["demo.Records", "Update", values]);
      await act(async () => view.container.querySelector<HTMLButtonElement>('[aria-label="Remove"]')!.click());
      await act(async () => view.container.querySelector<HTMLButtonElement>('[data-repeated-add="tags"]')!.click());
      await act(async () => { submit(view.container); });
      expect(invoke.mock.calls[2]).toEqual(["demo.Records", "Update", { ...values, tags: ["two", ""] }]);
    } finally { await view.close(); }
  });
  it("retains defaults after failed prefill and renders declared read-only values", async () => {
    const p = panel(); p.prefill = create(FormPanelSchema, { prefill: { service: "demo.Records", method: "Get" } }).prefill;
    const view = await mount(p, async () => { throw new Error("offline"); });
    try {
      expect(view.container.textContent).toContain("Could not load initial values: offline");
      expect(view.container.querySelector<HTMLInputElement>("input")!.value).toBe("Ada");
    } finally { await view.close(); }
    const readonly = create(FormPanelSchema, { mode: 1, fields: [{ fieldId: "due", label: "Due", kind: { case: "text", value: { defaultValue: "2026-03-29" } }, display: { type: ValueType.DATE } }] });
    const read = await mount(readonly, vi.fn(async () => ({})));
    try { expect(read.container.textContent).toContain("Mar 29, 2026"); expect(read.container.querySelector("button")).toBeNull(); }
    finally { await read.close(); }
  });
});
