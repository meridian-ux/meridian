import { create } from "@bufbuild/protobuf";
import { CommandSchema, LaunchpadSchema } from "@savvifi/meridian-proto-ts/proto/command_palette_pb.js";
import { AffordanceSchema } from "@savvifi/meridian-proto-ts/proto/affordance_pb.js";
import { MeridianProvider, htmlKit } from "@savvifi/meridian-web-react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Launchpad } from "../src/launchpad.js";

const container = document.getElementById("root")!;
const root = createRoot(container);
declare global {
  interface Window {
    launchpadStart: (mode: "allow" | "deny" | "pending") => void;
    launchpadSettle: () => void;
  }
}
window.launchpadStart = mode => {
  for (const key of ["calls", "closes", "runs", "legacy"]) container.dataset[key] = "0";
  container.dataset.aborted = "false";
  window.launchpadSettle = () => {};
  const bump = (key: string) => { container.dataset[key] = String(Number(container.dataset[key]) + 1); };
  const commands = [0, 1].map(id => create(CommandSchema, { id: String(id), title: `Envelope ${id}`, keywords: ["discoverable"],
    deepLink: "javascript:legacy", action: { case: "openViewId", value: "legacy" },
    affordance: create(AffordanceSchema, { label: `Copy ${id}`, description: "Canonical explanation", invoke: { case: "copy", value: `raw/${id}` } }),
  }));
  const descriptor = create(LaunchpadSchema, { groups: [{ id: "commands", commands }] });
  const invocation = { admit: () => mode !== "deny", capabilities: { copy: async (_value: string, _context: unknown, signal: AbortSignal) => {
    bump("calls"); container.dataset.aborted = "false";
    signal.addEventListener("abort", () => { container.dataset.aborted = "true"; }, { once: true });
    if (mode === "pending") await new Promise<void>(resolve => { window.launchpadSettle = resolve; });
  } } };
  const invoker = { invoke: async () => { throw new Error("No RPC in browser fixture"); } };
  function Controller() {
    const [open, setOpen] = useState(false);
    return <><button id="opener" onClick={() => setOpen(true)}>Open palette</button>
      <MeridianProvider invoker={invoker} kit={htmlKit} adhoc={{}} invocation={invocation} onAction={() => bump("legacy")}>
        <Launchpad descriptor={descriptor} open={open} onClose={() => { bump("closes"); setOpen(false); }}
          onRun={() => bump("runs")} onNavigate={() => bump("legacy")} onOpenView={() => bump("legacy")} />
      </MeridianProvider></>;
  }
  root.render(<Controller key={mode} />);
};
