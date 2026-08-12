import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MeridianProvider, htmlKit } from "@savvifi/meridian-web-react";

import { Launchpad } from "../src/index.js";
import { demoLaunchpad } from "./fixtures.js";

// A no-op transport — the render test never fires an rpc command.
const invoker = { invoke: async () => ({}) };

function render(open: boolean): string {
  return renderToStaticMarkup(
    <MeridianProvider invoker={invoker} kit={htmlKit} adhoc={{}}>
      <Launchpad descriptor={demoLaunchpad()} open={open} onClose={() => {}} />
    </MeridianProvider>,
  );
}

describe("<Launchpad>", () => {
  it("renders nothing when closed", () => {
    expect(render(false)).toBe("");
  });

  it("renders the placeholder, groups, and commands when open", () => {
    const html = render(true);
    expect(html).toContain("Search or jump");
    expect(html).toContain("Suggestions");
    expect(html).toContain("New product");
    expect(html).toContain("Go to settings");
    expect(html).toContain("Export data");
    // The command's shortcut/icon key survive into the markup.
    expect(html).toContain('data-icon="plus"');
  });
});
