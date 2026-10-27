import { muiKit } from "../src/mui_kit.js";
import { affordanceContract } from "../../web-react/tests/affordance_contract.js";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { create } from "@bufbuild/protobuf";
import { PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { MeridianProvider, PanelRenderer, ViewRenderer, reactWebRenderer } from "@savvifi/meridian-web-react";
import { actionSourcesContract } from "../../web-react/tests/action_sources_contract.js";
import { MeridianMuiProvider } from "../src/provider.js";
import { expect, it, vi } from "vitest";
affordanceContract(muiKit, { MeridianProvider, PanelRenderer, reactWebRenderer });
actionSourcesContract(muiKit, { MeridianProvider, PanelRenderer, ViewRenderer, reactWebRenderer });

it("MeridianMuiProvider forwards explicit host capabilities and context", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const copy = vi.fn(async () => {}), invoke = vi.fn(async () => ({}));
  const descriptor = create(PanelDescriptorSchema, { body: { case: "action", value: { action: {
    label: "Host copy", invoke: { case: "copy", value: "raw" },
  } } } });
  const context = { currentResourcePath: "provider/current", uiIdentity: null, selectedRow: { id: "provider-row" }, formValues: {} };
  try {
    await act(async () => root.render(createElement(MeridianMuiProvider, { invoker: { invoke },
      invocation: { capabilities: { copy }, admit: () => true, context }, children: createElement(PanelRenderer, { descriptor }),
    })));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith("raw", context, expect.any(AbortSignal));
    expect(invoke).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); }
});
