import test from "node:test";
import assert from "node:assert/strict";

import { safeNavigationHref } from "./navigation.js";

test("safeNavigationHref retains web, relative, mail, and application deep links", () => {
  for (const href of [
    "https://example.com/docs",
    "http://localhost:3000",
    "/sponsors/42",
    "?tab=details",
    "mailto:help@example.com",
    "cursor://anysphere.cursor-deeplink/mcp/install",
    "vscode:extension/example",
  ]) {
    assert.equal(safeNavigationHref(href), href);
  }
});

test("safeNavigationHref rejects executable, local, malformed, and empty destinations", () => {
  for (const href of [
    "javascript:alert(1)",
    " javaScript:alert(1) ",
    "data:text/html,unsafe",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
    "blob:https://example.com/opaque",
    "java\nscript:alert(1)",
    "https://[invalid",
    "",
    "   ",
  ]) {
    assert.equal(safeNavigationHref(href), undefined, href);
  }
});
