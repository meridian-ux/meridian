// Formatting from a DECLARED ValueDisplay, and the hydration contract that makes
// relative time safe on an SSR surface.
//
// The pure layer is tested here; the record-card wiring is covered in
// value_display_render.test.tsx.

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  PrincipalDisplay,
  TemporalDisplay,
  TemporalPrecision,
  ValueDisplaySchema,
  ValueType,
} from "@savvifi/meridian-proto-ts/proto/value_pb.js";

import {
  EMPTY_DISPLAY,
  formatByDisplay,
  formatRelativeTime,
  resolvePrincipalLink,
  resolveValueLink,
} from "../src/display_format.js";

describe("principal record routing inputs", () => {
  const linked = (type = ValueType.PRINCIPAL, targetKind = "identity.user", linkToRecord = true) =>
    create(ValueDisplaySchema, {
      type,
      options: { case: "principal", value: {
        targetKind, linkToRecord, display: PrincipalDisplay.NAME,
      } },
    });

  it("preserves the raw principal value and explicit kind across the protobuf boundary", () => {
    const display = fromBinary(ValueDisplaySchema, toBinary(ValueDisplaySchema, linked()));
    const value = "Ada <ada@example.com>";
    expect(formatByDisplay(value, display).text).toBe("Ada");
    expect(resolvePrincipalLink(value, display)).toEqual({ targetKind: "identity.user", id: value });
    expect(resolvePrincipalLink(0, display)).toEqual({ targetKind: "identity.user", id: "0" });
    expect(resolvePrincipalLink("a/b ?#", display)).toEqual({ targetKind: "identity.user", id: "a/b ?#" });
    expect(resolvePrincipalLink("ada@example.com", linked(ValueType.EMAIL)))
      .toEqual({ targetKind: "identity.user", id: "ada@example.com" });
  });

  it("declines absent, legacy, disabled, and mismatched declarations", () => {
    const legacy = create(ValueDisplaySchema, {
      type: ValueType.PRINCIPAL,
      options: { case: "principal", value: { linkToRecord: true } },
    });
    for (const display of [
      undefined, legacy, linked(ValueType.PRINCIPAL, "  "),
      linked(ValueType.PRINCIPAL, "identity.user", false), linked(ValueType.URL),
      create(ValueDisplaySchema, { type: ValueType.PRINCIPAL }),
      create(ValueDisplaySchema, { type: ValueType.PRINCIPAL, options: { case: "number", value: {} } }),
    ]) expect(resolvePrincipalLink("ada", display)).toBeUndefined();
  });

  it("declines empty and nonscalar values without inventing an entity ID", () => {
    for (const value of [null, undefined, "", " \t\n", {}, [], true, NaN, Infinity, -Infinity]) {
      expect(resolvePrincipalLink(value, linked())).toBeUndefined();
    }
  });
});

describe("general ValueLink routing inputs", () => {
  it("preserves explicit-link precedence and legacy absence through protobuf encoding", () => {
    const make = (link?: { targetKind: string }) => fromBinary(ValueDisplaySchema, toBinary(ValueDisplaySchema,
      create(ValueDisplaySchema, {
        type: ValueType.PRINCIPAL, link,
        options: { case: "principal", value: { linkToRecord: true, targetKind: "legacy" } },
      })));
    expect(resolveValueLink("  raw /?#  ", make({ targetKind: " build " })))
      .toEqual({ targetKind: "build", id: "  raw /?#  " });
    expect(resolveValueLink("id", make())).toEqual({ targetKind: "legacy", id: "id" });
    expect(resolveValueLink("id", make({ targetKind: "" }))).toBeUndefined();
    expect(resolveValueLink("id", make({ targetKind: "  " }))).toBeUndefined();
    for (const value of [null, undefined, "", "  ", {}, [], true, NaN, Infinity, -Infinity]) {
      expect(resolveValueLink(value, make({ targetKind: "build" }))).toBeUndefined();
    }
    expect(resolveValueLink(0, make({ targetKind: "build" }))).toEqual({ targetKind: "build", id: "0" });
  });

  it("routes any declared scalar value without changing its display text", () => {
    const display = create(ValueDisplaySchema, {
      type: ValueType.IDENTIFIER,
      link: { targetKind: "build" },
    });
    expect(formatByDisplay("build_123", display).text).toBe("build_123");
    expect(resolveValueLink("build_123", display)).toEqual({ targetKind: "build", id: "build_123" });
    expect(resolveValueLink(42, display)).toEqual({ targetKind: "build", id: "42" });
  });

  it("keeps malformed general link declarations inert", () => {
    const display = create(ValueDisplaySchema, {
      type: ValueType.IDENTIFIER,
      link: { targetKind: "   " },
    });
    expect(resolveValueLink("build_123", display)).toBeUndefined();
    expect(resolveValueLink({}, create(ValueDisplaySchema, { type: ValueType.IDENTIFIER, link: { targetKind: "build" } })))
      .toBeUndefined();
  });
});

// 2026-07-30T12:00:00Z, so every expectation below is a fixed offset from it.
const NOW = Date.parse("2026-07-30T12:00:00.000Z");

describe("declared numeric rounding (paired with native wire/table/stat tests)", () => {
  it("rounds exact binary ties away from zero without changing nearby values", () => {
    for (const [value, digits, expected] of [
      [12.5, 0, "13"], [-12.5, 0, "-13"], [13.5, 0, "14"],
      [1.125, 2, "1.13"], [-1.125, 2, "-1.13"], [1.375, 2, "1.38"],
      [9.5, 0, "10"], [2.675, 2, "2.67"], [1.005, 2, "1.00"],
      [0.49999999999999994, 0, "0"], [0.5000000000000001, 0, "1"],
      [-0, 2, "0.00"], [-0.01, 0, "-0"],
      [2 ** -101, 100,
        "0.0000000000000000000000000000003944304526105059027058642826413931148366032175545115023851394653320313"],
      [Number.MIN_VALUE, 100, `0.${"0".repeat(100)}`],
    ] as const) {
      for (const type of [ValueType.INTEGER, ValueType.DECIMAL, ValueType.MONEY, ValueType.PERCENT]) {
        const display = fromBinary(ValueDisplaySchema, toBinary(ValueDisplaySchema,
          create(ValueDisplaySchema, { type, options: { case: "number", value: { fractionDigits: digits } } })));
        expect(formatByDisplay(value, display).text).toBe(expected);
      }
    }
  });
});

// The native table formatter runs these same precision boundary cases. Decode
// the declaration first: absent optional precision and explicit zero differ.
describe.each([ValueType.INTEGER, ValueType.DECIMAL, ValueType.MONEY, ValueType.PERCENT])(
  "numeric precision contract for ValueType %s", (type) => {
    it.each([
      [undefined, "1.125"], [0, "1"], [3, "1.125"],
      [100, `1.125${"0".repeat(97)}`],
      [-1, "1.125"], [-2147483648, "1.125"], [101, "1.125"], [2147483647, "1.125"],
    ] as const)("preserves bounded behavior for precision %s", (fractionDigits, expected) => {
      const display = fromBinary(ValueDisplaySchema, toBinary(ValueDisplaySchema,
        create(ValueDisplaySchema, { type, options: { case: "number", value: { fractionDigits } } })));
      expect(formatByDisplay(1.125, display).text).toBe(expected);
      expect(formatByDisplay("001.125", display).text).toBe("001.125");
      expect(formatByDisplay(null, display).text).toBe(EMPTY_DISPLAY);
    });
  },
);

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

  it("formats declared time values with optional seconds", () => {
    const time = (precision?: TemporalPrecision) =>
      create(ValueDisplaySchema, {
        type: ValueType.TIME,
        options: { case: "temporal", value: { precision } },
      });
    expect(formatByDisplay("09:14", time()).text).toBe("9:14 AM UTC");
    expect(formatByDisplay("21:14:07", time(TemporalPrecision.SECOND)).text).toBe(
      "9:14:07 PM UTC",
    );
    expect(formatByDisplay("not-a-time", time()).text).toBe("not-a-time");
  });

  it("PRINCIPAL realizes name and email display modes", () => {
    const who = create(ValueDisplaySchema, { type: ValueType.PRINCIPAL });
    expect(formatByDisplay("Ruchi Sharma", who).text).toBe("Ruchi Sharma");

    const email = create(ValueDisplaySchema, {
      type: ValueType.PRINCIPAL,
      options: { case: "principal", value: { display: PrincipalDisplay.EMAIL } },
    });
    expect(formatByDisplay("Ruchi Sharma <ruchi@example.com>", email).text).toBe("ruchi@example.com");

    const titled = create(ValueDisplaySchema, {
      type: ValueType.PRINCIPAL,
      options: {
        case: "principal",
        value: { display: PrincipalDisplay.NAME_WITH_EMAIL_TITLE },
      },
    });
    expect(formatByDisplay("Ruchi Sharma <ruchi@example.com>", titled)).toEqual({
      text: "Ruchi Sharma",
      title: "ruchi@example.com",
    });

    // A producer that only has the address still gets useful output for every
    // principal display mode; no renderer invents a blank name.
    expect(formatByDisplay("ruchi@example.com", who).text).toBe("ruchi@example.com");

    const address = create(ValueDisplaySchema, {
      type: ValueType.EMAIL,
      options: { case: "principal", value: { display: PrincipalDisplay.EMAIL } },
    });
    expect(formatByDisplay("Ruchi Sharma <ruchi@example.com>", address).text)
      .toBe("ruchi@example.com");
  });

  it("keeps malformed principal labels and missing values readable in every mode", () => {
    for (const mode of [PrincipalDisplay.UNSPECIFIED, PrincipalDisplay.NAME, PrincipalDisplay.EMAIL, PrincipalDisplay.NAME_WITH_EMAIL_TITLE, 99]) {
      const display = create(ValueDisplaySchema, {
        type: ValueType.PRINCIPAL,
        options: { case: "principal", value: { display: mode } },
      });
      for (const value of [
        "Ruchi Sharma", "ruchi@example.com", "Name <@example.com>",
        "Name <user@>", "Name <user@@example.com>", "Name < user@example.com>",
        "Name <<user@example.com>>", " <user@example.com>",
        "Name <user@example.com> trailing", "Name <user@example.com>\n",
        "Name <user\u0085@example.com>",
      ]) {
        expect(formatByDisplay(value, display), `${mode}: ${value}`).toEqual({ text: value });
      }
      for (const value of [null, undefined, ""]) {
        expect(formatByDisplay(value, display)).toEqual({ text: "—" });
      }
      const expected = mode === PrincipalDisplay.EMAIL
        ? { text: "ruchi@example.com" }
        : mode === PrincipalDisplay.NAME_WITH_EMAIL_TITLE
          ? { text: "Ruchi Sharma", title: "ruchi@example.com" }
          : { text: "Ruchi Sharma" };
      expect(formatByDisplay("Ruchi Sharma <ruchi@example.com>", display)).toEqual(expected);
    }
    expect(formatByDisplay("Ruchi Sharma <ruchi@example.com>", undefined)).toEqual({
      text: "Ruchi Sharma <ruchi@example.com>",
    });
  });

  it("honors declared numeric precision", () => {
    const decimal = create(ValueDisplaySchema, {
      type: ValueType.DECIMAL,
      options: { case: "number", value: { fractionDigits: 2 } },
    });
    expect(formatByDisplay(1.236, decimal).text).toBe("1.24");
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
