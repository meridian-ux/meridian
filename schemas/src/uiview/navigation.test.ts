import test from "node:test";
import assert from "node:assert/strict";

import { safeAssetSrc, safeNavigationHref, safeWebSocketUrl } from "./navigation.js";

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

test("safeAssetSrc retains host-relative and HTTP(S) asset sources", () => {
  for (const src of [
    "/evidence/frame.png",
    "../frames/frame.png",
    "?asset=frame",
    "https://cdn.example.com/frame.png",
    "http://localhost:3000/frame.png",
  ]) {
    assert.equal(safeAssetSrc(src), src);
  }
});

test("safeAssetSrc rejects active, local, opaque, malformed, and empty sources", () => {
  for (const src of [
    "javascript:alert(1)",
    "data:image/svg+xml,unsafe",
    "file:///etc/passwd",
    "blob:https://example.com/opaque",
    "cursor://file/workspace/frame.png",
    "java\nscript:alert(1)",
    "https://[invalid",
    "",
    "   ",
  ]) {
    assert.equal(safeAssetSrc(src), undefined, src);
  }
});

test("safeWebSocketUrl retains credential-free ws and wss broker URLs", () => {
  for (const url of [
    "wss://terminal.example.com/pty?session=abc",
    "ws://localhost:8080/pty",
  ]) {
    assert.equal(safeWebSocketUrl(url), url);
  }
});

test("safeWebSocketUrl rejects non-WebSocket, relative, credentialed, fragmented, and malformed URLs", () => {
  for (const url of [
    "https://terminal.example.com/pty",
    "javascript:alert(1)",
    "/pty/session",
    "wss://user:secret@terminal.example.com/pty",
    "wss://terminal.example.com/pty#fragment",
    "wss://terminal.example.com/pt\ny",
    "wss://[invalid",
    "",
    "   ",
  ]) {
    assert.equal(safeWebSocketUrl(url), undefined, url);
  }
});
