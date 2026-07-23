// @vitest-environment jsdom
//
// The browser bundle is the ENTIRE surface a bundler-free host can reach: if a
// symbol is not re-exported from browser.ts, it does not exist for them, no
// matter that renderer.ts exports it.
//
// That is not hypothetical — `supportsBody` was added to stop hosts re-deriving
// the dispatch, and shipped unexported, so the very host it was written for
// imported `undefined`. Same duplicated-surface mistake the export was meant to
// fix, one layer up. This pins the contract.

import { describe, expect, it } from "vitest";

import * as browser from "../src/browser.js";

// What a host driving meridian panels itself cannot work without.
const REQUIRED = [
  "renderPanel",
  "renderView",
  "supportsBody",
  "SUPPORTED_BODIES",
  "disposePanel",
  "decodeBundle",
  "encodeGalleryPanel",
  "registerChatPanel",
  "CHAT_PANEL_CSS",
  "webComponentsRenderer",
] as const;

describe("the browser bundle exposes the host-facing surface", () => {
  for (const name of REQUIRED) {
    it(`exports \`${name}\``, () => {
      expect(browser[name as keyof typeof browser]).toBeDefined();
    });
  }

  it("supportsBody works through the bundle, not just the module", () => {
    expect(browser.supportsBody("stream")).toBe(true);
    expect(browser.supportsBody("gallery")).toBe(false);
  });
});
