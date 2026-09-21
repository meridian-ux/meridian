// StatPanel — the shared computeStat parity vectors + the KPI-tile render across
// both reference kits. The delta/trend is COMPUTED (never author-marked); a
// declining series that a bad dashboard would mark "up" computes DOWN. Semantic
// color only when higher_is_better is set.
//
// PARITY: the `format_parity_vectors` + compute cases below are the SAME (input →
// expected) rows asserted in the Rust test
// (meridian-uiview-core rust/uiview/src/stat.rs). Both languages must produce
// byte-identical strings/trends — this is the html↔tui divergence guard.

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PanelDescriptorSchema,
  type PanelDescriptor,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { StatPanelSchema } from "@savvifi/meridian-proto-ts/proto/stat_pb.js";
import { ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { computeStat, formatStatNumber } from "@savvifi/meridian-schemas/uiview";
import type { RpcInvoker } from "@savvifi/meridian-schemas/uiview";

import type { ComponentKit } from "../src/component_kit.js";
import { htmlKit } from "../src/html_kit.js";
import { PanelRenderer } from "../src/panel_renderer.js";
import { MeridianProvider } from "../src/provider.js";
import { shadcnKit } from "../src/shadcn_kit.js";

// ── the parity vectors (identical to stat.rs) ────────────────────────────────
describe("formatStatNumber parity vectors (must match the Rust formatter)", () => {
  it("formats each ValueFormat deterministically", () => {
    expect(formatStatNumber(1234.5, 1)).toBe("1,234.5"); // NUMBER grouped
    expect(formatStatNumber(1234, 5)).toBe("1234"); // PLAIN
    expect(formatStatNumber(87.5, 2)).toBe("87.5%"); // PERCENT
    expect(formatStatNumber(1234, 3)).toBe("$1,234.00"); // CURRENCY
    expect(formatStatNumber(1500000, 4)).toBe("1.5M"); // COMPACT
    expect(formatStatNumber(1200, 4)).toBe("1.2K");
    expect(formatStatNumber(-5, 3)).toBe("-$5.00");
    expect(formatStatNumber(12.567, 1)).toBe("12.57");
  });
});

const stat = (v: Parameters<typeof create<typeof StatPanelSchema>>[1]) => create(StatPanelSchema, v);

describe("computeStat — computed delta/trend/semantics (parity with Rust)", () => {
  it("uses numeric ValueDisplay after wire decode for both value and delta", () => {
    for (const type of [ValueType.INTEGER, ValueType.DECIMAL, ValueType.MONEY, ValueType.PERCENT]) {
      for (const digits of [undefined, 0, 3, 100, -1, -2147483648, 101, 2147483647]) {
        const p = stat({ value: 12.625, previous: 10.25, format: 3, unit: "items",
          valueDisplay: { type, options: { case: "number", value: { fractionDigits: digits } } },
        });
        const c = computeStat(fromBinary(StatPanelSchema, toBinary(StatPanelSchema, p)));
        const valid = digits !== undefined && digits >= 0 && digits <= 100;
        const suffix = type === ValueType.MONEY || type === ValueType.PERCENT ? "" : " items";
        expect(c.formattedValue).toBe((valid ? (12.625).toFixed(digits) : "12.625") + suffix);
        expect(c.formattedDelta).toBe("+" + (valid ? (2.375).toFixed(digits) : "2.375"));
        expect(c.trend).toBe("up");
      }
    }
  });

  it("retains legacy formats for absent, unspecified, unknown, and nonnumeric declarations", () => {
    for (const type of [undefined, ValueType.UNSPECIFIED, ValueType.TEXT, 999]) {
      const c = computeStat(stat({ value: 12.5, previous: 10.25, format: 3, unit: "ignored",
        valueDisplay: type === undefined ? undefined : { type },
      }));
      expect(c.formattedValue).toBe("$12.50");
      expect(c.formattedDelta).toBe("+$2.25");
    }
  });

  it("keeps series deltas, overrides, and direction independent of declared formatting", () => {
    const p = stat({ value: -2.25, format: 2, series: [10.25, 12.5], higherIsBetter: false,
      valueDisplay: { type: ValueType.DECIMAL, options: { case: "number", value: { fractionDigits: 3 } } },
    });
    expect(computeStat(p)).toMatchObject({ formattedValue: "-2.250", formattedDelta: "+2.250", semantics: "bad" });
    p.previous = 0;
    expect(computeStat(p)).toMatchObject({ formattedDelta: "-2.250", trend: "down", semantics: "good" });
    p.deltaOverride = "pending";
    expect(computeStat(p).formattedDelta).toBe("pending");
    p.deltaOverride = "";
    expect(computeStat(p).formattedDelta).toBe("");
    p.previous = undefined;
    p.series = [];
    p.deltaOverride = undefined;
    expect(computeStat(p).formattedDelta).toBeNull();
  });
  it("delta from previous, semantic color when higher_is_better", () => {
    const c = computeStat(stat({ label: "m", value: 120, format: 1, previous: 150, higherIsBetter: true }));
    expect(c.formattedValue).toBe("120");
    expect(c.trend).toBe("down");
    expect(c.formattedDelta).toBe("-30");
    expect(c.semantics).toBe("bad"); // down when higher-is-better = bad
  });

  it("trend from a declining series that would be mismarked → DOWN, neutral", () => {
    const c = computeStat(stat({ label: "m", value: 5, format: 5, series: [10, 8, 6, 5] }));
    expect(c.trend).toBe("down");
    expect(c.formattedDelta).toBe("-5"); // 5 − 10
    expect(c.semantics).toBe("neutral"); // no higher_is_better
    expect(c.series.length).toBe(4);
  });

  it("no semantic color without higher_is_better", () => {
    const c = computeStat(stat({ label: "m", value: 200, format: 1, previous: 150 }));
    expect(c.trend).toBe("up");
    expect(c.semantics).toBe("neutral");
  });

  it("declared ValueDisplay overrides legacy format for value and delta", () => {
    const c = computeStat(stat({
      label: "Revenue",
      value: 1234.4,
      format: 2,
      previous: 1000,
      unit: "USD",
      valueDisplay: {
        type: ValueType.MONEY,
        options: { case: "number", value: { fractionDigits: 0 } },
      },
    }));
    expect(c.formattedValue).toBe("1234");
    expect(c.formattedDelta).toBe("+234");
  });
});

// ── render across both kits ──────────────────────────────────────────────────
const invoker: RpcInvoker = { invoke: async () => ({}) };
function render(kit: ComponentKit, descriptor: PanelDescriptor): string {
  return renderToStaticMarkup(
    createElement(
      MeridianProvider,
      { invoker, kit, adhoc: {} },
      createElement(PanelRenderer, { descriptor }),
    ),
  );
}
const statDesc = (v: Parameters<typeof create<typeof StatPanelSchema>>[1]): PanelDescriptor =>
  create(PanelDescriptorSchema, { panelId: "s", title: "S", body: { case: "stat", value: create(StatPanelSchema, v) } });

const kits: [string, ComponentKit][] = [
  ["htmlKit", htmlKit],
  ["shadcnKit", shadcnKit],
];

describe.each(kits)("StatPanel renders as a KPI tile (%s)", (_n, kit) => {
  it("keeps invalid decimal precision on the declared fallback instead of legacy currency", () => {
    const html = render(kit, statDesc({ value: 12.5, previous: 10.25, format: 3, unit: "items",
      valueDisplay: { type: ValueType.DECIMAL, options: { case: "number", value: { fractionDigits: 2147483647 } } },
    }));
    expect(html).toContain("12.5 items");
    expect(html).toContain("+2.25");
    expect(html).not.toContain("$");
  });
  it("renders declared precision over legacy percent and preserves the unit", () => {
    const html = render(kit, statDesc({ value: 12.5, previous: 10.25, format: 2, unit: "items",
      valueDisplay: { type: ValueType.DECIMAL, options: { case: "number", value: { fractionDigits: 3 } } },
    }));
    expect(html).toContain("12.500 items");
    expect(html).toContain("+2.250");
    expect(html).not.toContain("12.5%");
  });
  it("value + unit, computed delta with data-semantics, and a hand-drawn sparkline", () => {
    const html = render(
      kit,
      statDesc({ label: "Churn", value: 5.2, format: 2, previous: 4.0, series: [4, 4.5, 5, 5.2], higherIsBetter: false, unit: "" }),
    );
    expect(html).toContain("Churn");
    expect(html).toContain("5.2%"); // formatted value
    expect(html).toContain("↑"); // rising
    expect(html).toContain("+1.2%"); // computed delta 5.2 − 4.0
    expect(html).toContain('data-semantics="bad"'); // churn up = bad (higher_is_better=false)
    expect(html).toContain("<polyline"); // inline SVG sparkline, no chart lib
  });

  it("no delta badge when there is no previous/series", () => {
    const html = render(kit, statDesc({ label: "Total", value: 42, format: 1 }));
    expect(html).toContain("42");
    expect(html).not.toContain("mer-stat-delta");
  });
});
