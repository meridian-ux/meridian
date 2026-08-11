// Formatting from a DECLARED ValueDisplay, and the hydration contract that makes
// relative time safe on an SSR surface.
//
// The pure layer is tested here; the record-card wiring is covered in
// value_display_render.test.tsx.

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  TemporalDisplay,
  TemporalPrecision,
  ValueDisplaySchema,
  ValueType,
} from "@savvifi/meridian-proto-ts/proto/value_pb.js";

import { EMPTY_DISPLAY, formatByDisplay, formatRelativeTime } from "../src/display_format.js";

// 2026-07-30T12:00:00Z, so every expectation below is a fixed offset from it.
const NOW = Date.parse("2026-07-30T12:00:00.000Z");

const temporal = (
  type: ValueType,
  display: TemporalDisplay,
  precision = TemporalPrecision.UNSPECIFIED,
) =>
  create(ValueDisplaySchema, {
    type,
    options: { case: "temporal", value: { display, precision } },
  });

describe("formatRelativeTime", () => {
  it("picks a grain by magnitude, past and future", () => {
    const at = (iso: string) => formatRelativeTime(iso, NOW);
    expect(at("2026-07-30T11:59:30.000Z")).toBe("just now");
    expect(at("2026-07-30T11:30:00.000Z")).toBe("30 minutes ago");
    expect(at("2026-07-30T04:00:00.000Z")).toBe("8 hours ago");
    expect(at("2026-07-25T12:00:00.000Z")).toBe("5 days ago");
    expect(at("2026-04-30T12:00:00.000Z")).toBe("3 months ago");
    expect(at("2024-07-30T12:00:00.000Z")).toBe("2 years ago");
    // Future reads forward, which is what a due date needs.
    expect(at("2026-08-02T12:00:00.000Z")).toBe("in 3 days");
  });

  it("returns undefined for text that is not a timestamp", () => {
    // Same contract as formatTimestamp: callers fall through rather than getting
    // "Invalid Date".
    expect(formatRelativeTime("Acme Benefits", NOW)).toBeUndefined();
    expect(formatRelativeTime("", NOW)).toBeUndefined();
  });
});

describe("formatByDisplay — the hydration contract", () => {
  const posted = temporal(ValueType.DATE_TIME, TemporalDisplay.RELATIVE);

  it("WITHOUT a now instant, a relative field renders ABSOLUTE", () => {
    // This is the SSR / first-client-paint path. Both sides must agree, so the
    // absence of `nowMs` is meaningful, not a missing argument.
    expect(formatByDisplay("2026-07-25T09:18:00.000Z", posted).text).toBe(
      "Jul 25, 2026, 9:18 AM UTC",
    );
  });

  it("WITH a now instant, the same field renders relative", () => {
    expect(formatByDisplay("2026-07-25T09:18:00.000Z", posted, NOW).text).toBe("5 days ago");
  });

  it("server and client agree before mount — byte-identical output", () => {
    const server = formatByDisplay("2026-07-25T09:18:00.000Z", posted);
    const firstPaint = formatByDisplay("2026-07-25T09:18:00.000Z", posted, undefined);
    expect(server).toEqual(firstPaint);
  });

  it("RELATIVE_WITH_ABSOLUTE_TITLE carries both", () => {
    const both = temporal(ValueType.DATE_TIME, TemporalDisplay.RELATIVE_WITH_ABSOLUTE_TITLE);
    const shown = formatByDisplay("2026-07-25T09:18:00.000Z", both, NOW);
    expect(shown.text).toBe("5 days ago");
    expect(shown.title).toBe("Jul 25, 2026, 9:18 AM UTC");
  });
});

describe("formatByDisplay — types", () => {
  it("DATE drops a time-of-day even when the value carries one", () => {
    // A due date stored midnight-Z must not read "12:00 AM", and a due date that
    // picked up a stray time must not start showing it either.
    const due = temporal(ValueType.DATE, TemporalDisplay.ABSOLUTE);
    expect(formatByDisplay("2026-03-29T00:00:00.000Z", due).text).toBe("Mar 29, 2026");
    expect(formatByDisplay("2026-03-29T14:02:00.000Z", due).text).toBe("Mar 29, 2026");
  });

  it("a due date declared ABSOLUTE stays absolute even with a now instant", () => {
    // The decided rule: relative for created/posted, absolute for due/scheduled.
    // The field says which; passing `now` must not override it.
    const due = temporal(ValueType.DATE, TemporalDisplay.ABSOLUTE);
    expect(formatByDisplay("2026-08-02T00:00:00.000Z", due, NOW).text).toBe("Aug 2, 2026");
  });

  it("BOOLEAN reads Yes/No, LIST joins, empty reads as an em dash", () => {
    const of = (type: ValueType) => create(ValueDisplaySchema, { type });
    expect(formatByDisplay(true, of(ValueType.BOOLEAN)).text).toBe("Yes");
    expect(formatByDisplay(false, of(ValueType.BOOLEAN)).text).toBe("No");
    expect(formatByDisplay(["a", "b"], of(ValueType.LIST)).text).toBe("a, b");
    expect(formatByDisplay(null, of(ValueType.DATE_TIME)).text).toBe(EMPTY_DISPLAY);
    expect(formatByDisplay("", of(ValueType.PRINCIPAL)).text).toBe(EMPTY_DISPLAY);
  });

  it("PRINCIPAL passes the producer's label through unchanged", () => {
    // The renderer's job is not to invent a name; the projection resolves the
    // reference upstream, so by here the value already IS the label.
    const who = create(ValueDisplaySchema, { type: ValueType.PRINCIPAL });
    expect(formatByDisplay("Ruchi Sharma", who).text).toBe("Ruchi Sharma");
  });

  it("an ABSENT or UNSPECIFIED display defers to the existing inference", () => {
    // The compatibility guarantee: every descriptor emitted before ValueDisplay
    // renders exactly as it did, including the ISO sniff.
    expect(formatByDisplay("2026-03-29T00:00:00.000Z", undefined).text).toBe("Mar 29, 2026");
    const unspecified = create(ValueDisplaySchema, { type: ValueType.UNSPECIFIED });
    expect(formatByDisplay("2026-03-29T00:00:00.000Z", unspecified).text).toBe("Mar 29, 2026");
    expect(formatByDisplay(true, undefined).text).toBe("Yes");
  });
});
