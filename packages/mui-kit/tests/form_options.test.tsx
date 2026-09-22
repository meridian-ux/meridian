import { create } from "@bufbuild/protobuf";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ViewRenderer } from "@savvifi/meridian-web-react";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import { FormFieldSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { MeridianMuiProvider } from "../src/provider.js";
import { validateFormOptions } from "../src/form_options.js";

afterEach(cleanup);
const field = () => create(FormFieldSchema, { fieldId: "region", label: "Region", kind: { case: "enumSelection", value: {
  defaultValue: "east", allowedValues: ["obsolete"], optionsSource: { service: "Regions", method: "List", optionsField: "outer.items", valueField: "region.id", labelField: "region.label" },
} } });
function mount(invoke: ReturnType<typeof vi.fn>, prefill = false) {
  const view = create(ViewDescriptorSchema, { id: "form", layout: { mode: { case: "stacked", value: {} } }, slots: [{ id: "form", panel: {
    panelId: "form", body: { case: "form", value: { mode: 2, fields: [field()], submit: { service: "Regions", method: "Save" },
      ...(prefill ? { prefill: { service: "Regions", method: "Get" } } : {}),
    } },
  } }] });
  return render(<MeridianMuiProvider invoker={{ invoke }} admission={{ mutations: ["Regions/Save"] }}><ViewRenderer view={view} /></MeridianMuiProvider>);
}
it("loads dotted paths through read admission and preserves prefill tokens on submit", async () => {
  const invoke = vi.fn(async (_service, method) => method === "List" ? { outer: { items: [
    { region: { id: "east", label: "East coast" } }, { region: { id: "west", label: "West coast" } },
  ] } } : method === "Get" ? { region: "west" } : {});
  mount(invoke, true);
  expect(screen.getByRole("status").textContent).toContain("Loading");
  await screen.findByText("West coast");
  expect(invoke).toHaveBeenCalledWith("Regions", "List", {});
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("Regions", "Save", { region: "west" }));
});
it.each(["failure", "empty", "malformed"])("blocks submission on %s without substituting static options", async mode => {
  const invoke = vi.fn(async () => { if (mode === "failure") throw new Error("Offline"); return mode === "empty" ? { outer: { items: [] } } : {}; });
  mount(invoke);
  await screen.findByRole("alert");
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("rejects an unresolved prefilled token before mutation transport", async () => {
  const invoke = vi.fn(async (_service, method) => method === "List" ? { outer: { items: [{ region: { id: "west" } }] } } : {});
  mount(invoke);
  await waitFor(() => expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toContain("select an available option");
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("validates dynamic tokens inside nested and repeated values", () => {
  const resolved = field();
  if (resolved.kind.case !== "enumSelection") throw new Error("enum expected");
  resolved.kind.value.options = [{ $typeName: "meridian.ui.v1.EnumOption", value: "east", label: "East", tone: 0 }];
  const nested = create(FormFieldSchema, { fieldId: "settings", kind: { case: "nested", value: { fields: [resolved] } } });
  const repeated = create(FormFieldSchema, { fieldId: "regions", kind: { case: "repeated", value: { element: { case: "scalar", value: resolved } } } });
  expect(validateFormOptions([nested, repeated], { settings: { region: "east" }, regions: ["east"] })).toBeUndefined();
  expect(validateFormOptions([nested, repeated], { settings: { region: "east" }, regions: ["forged"] })).toContain("available option");
});
