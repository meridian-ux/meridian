import { expect, it } from "vitest";

import {
  safeAssetSrc,
  safeFetchUrl,
  safeFontSrc,
  safeNavigationHref,
  safeWebSocketUrl,
} from "./navigation.js";

it("safeNavigationHref retains web, relative, mail, and application deep links", () => {
  for (const href of [
    "https://example.com/docs",
    "http://localhost:3000",
    "/sponsors/42",
    "?tab=details",
    "mailto:help@example.com",
    "cursor://anysphere.cursor-deeplink/mcp/install",
    "vscode:extension/example",
  ]) {
    expect(safeNavigationHref(href)).toBe(href);
  }
});

it("safeNavigationHref rejects executable, local, malformed, and empty destinations", () => {
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
    expect(safeNavigationHref(href), href).toBeUndefined();
  }
});

it("safeAssetSrc retains host-relative and HTTP(S) asset sources", () => {
  for (const src of [
    "/evidence/frame.png",
    "../frames/frame.png",
    "?asset=frame",
    "https://cdn.example.com/frame.png",
    "http://localhost:3000/frame.png",
  ]) {
    expect(safeAssetSrc(src)).toBe(src);
  }
});

it("safeAssetSrc rejects active, local, opaque, malformed, and empty sources", () => {
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
    expect(safeAssetSrc(src), src).toBeUndefined();
  }
});

it("safeFontSrc retains web assets and narrowly typed embedded fonts", () => {
  for (const src of [
    "/fonts/outfit.woff2",
    "https://cdn.example.com/outfit.woff2",
    "data:font/woff2;base64,d09GMgABAAAAAA==",
    "data:font/ttf;base64,AAEAAAALAIAAAwAwT1MvMg==",
  ]) {
    expect(safeFontSrc(src)).toBe(src);
  }
});

it("safeFontSrc rejects active, local, and non-font data sources", () => {
  for (const src of [
    "javascript:alert(1)",
    "file:///tmp/outfit.woff2",
    "blob:https://example.com/opaque",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:font/woff2,not-base64",
    "data:font/woff2;base64,not base64",
    "data:font/woff2;base64,AA\n==",
  ]) {
    expect(safeFontSrc(src), src).toBeUndefined();
  }
});

it("safeWebSocketUrl retains credential-free ws and wss broker URLs", () => {
  for (const url of [
    "wss://terminal.example.com/pty?session=abc",
    "ws://localhost:8080/pty",
  ]) {
    expect(safeWebSocketUrl(url)).toBe(url);
  }
});

it("safeWebSocketUrl rejects non-WebSocket, relative, credentialed, fragmented, and malformed URLs", () => {
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
    expect(safeWebSocketUrl(url), url).toBeUndefined();
  }
});

it("safeFetchUrl retains relative and credential-free HTTP(S) request targets", () => {
  for (const url of [
    "/api/save",
    "../actions/run",
    "?operation=refresh",
    "https://api.example.com/run",
    "http://localhost:8080/run",
  ]) {
    expect(safeFetchUrl(url)).toBe(url);
  }
});

it("safeFetchUrl rejects active, local, credentialed, malformed, and empty targets", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/plain,unsafe",
    "file:///etc/passwd",
    "blob:https://example.com/opaque",
    "https://user:secret@example.com/run",
    "https://example.com/r\nun",
    "https://[invalid",
    "",
    "   ",
  ]) {
    expect(safeFetchUrl(url), url).toBeUndefined();
  }
});
