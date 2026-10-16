import { create } from "@bufbuild/protobuf";
import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { FieldBindingSchema, RpcCallSchema } from "@savvifi/meridian-proto-ts/proto/rpc_pb.js";
import { MeridianInitialDataContext, MeridianSelectionContext, PanelRenderer } from "@savvifi/meridian-web-react";
import { MeridianMuiProvider } from "../src/provider.js";

afterEach(cleanup);
beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterAll(() => vi.unstubAllGlobals());

describe("MUI populate request admission", () => {
  for (const arm of ["table", "chart", "form", "resourceCards"] as const) {
    it.each(["unsafe", "large", "cycle"])(`${arm}: rejects %s before transport or seed consumption`, async mode => {
      const field = create(FieldBindingSchema, { requestField: mode === "unsafe" ? "__proto__.scope" : "payload",
        source: mode === "cycle" ? { case: "nested", value: {} } : { case: "literal", value: "x".repeat(mode === "large" ? 800_000 : 1) } });
      if (field.source.case === "nested") field.source.value.fields.push(field);
      const call = create(RpcCallSchema, { service: "demo.Reads", method: "Get", bindings: [field] });
      const descriptor = create(PanelDescriptorSchema, { body: arm === "table"
        ? { case: "table", value: { populate: call, rowsField: "items", columns: [{ header: "Name", fieldPath: "name" }] } }
        : arm === "chart" ? { case: "chart", value: { chart: { populate: call, rowsField: "items", x: { fieldName: "name" } } } }
          : arm === "form" ? { case: "form", value: { mode: 2, prefill: call, fields: [{ fieldId: "name", kind: { case: "text", value: {} } }] } }
            : { case: "resourceCards", value: { populate: call, rowsField: "items", template: { titleField: "name" } } },
      });
      const invoke = vi.fn(async () => ({ items: [{ name: "Unexpected transport" }] }));
      const view = render(<MeridianMuiProvider invoker={{ invoke }}>
        <MeridianInitialDataContext.Provider value={{ "demo.Reads.Get": { rows: [{ name: "Wrong seed" }] } }}>
          <PanelRenderer descriptor={descriptor} />
        </MeridianInitialDataContext.Provider>
      </MeridianMuiProvider>);
      await act(async () => {});
      expect(invoke).not.toHaveBeenCalled();
      expect(view.container.textContent).not.toContain("Wrong seed");
      expect(view.container.textContent).toMatch(/Failed to load|Unable to load|Form request rejected/);
    });
  }

  it("refetches a nested selection dependency but not an unrelated selection change", async () => {
    const descriptor = create(PanelDescriptorSchema, { body: { case: "chart", value: { chart: {
      rowsField: "items", populate: { service: "demo.Reads", method: "Get", bindings: [{ requestField: "scope", source: { case: "nested", value: {
        fields: [{ requestField: "tenant", source: { case: "selectionKey", value: "tenant" } }],
      } } }] },
    } } } });
    const invoke = vi.fn(async () => ({ items: [] }));
    const transport = { invoke };
    const tree = (tenant: string, unrelated = "") => <MeridianMuiProvider invoker={transport}>
      <MeridianSelectionContext.Provider value={{ values: { tenant, unrelated }, set: () => {} }}>
        <PanelRenderer descriptor={descriptor} />
      </MeridianSelectionContext.Provider>
    </MeridianMuiProvider>;
    const view = render(tree("one"));
    await act(async () => {});
    expect(invoke).toHaveBeenLastCalledWith("demo.Reads", "Get", { scope: { tenant: "one" } });
    view.rerender(tree("two"));
    await act(async () => {});
    expect(invoke).toHaveBeenLastCalledWith("demo.Reads", "Get", { scope: { tenant: "two" } });
    view.rerender(tree("two", "changed"));
    await act(async () => {});
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
