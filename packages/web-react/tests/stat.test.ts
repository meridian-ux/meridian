// StatPanel — the shared computeStat parity vectors + the KPI-tile render across
// both reference kits. The delta/trend is COMPUTED (never author-marked); a
// declining series that a bad dashboard would mark "up" computes DOWN. Semantic
// color only when higher_is_better is set.
//
// PARITY: the `format_parity_vectors` + compute cases below are the SAME (input →
// expected) rows asserted in the Rust test
// (meridian-uiview-core rust/uiview/src/stat.rs). Both languages must produce
// byte-identical strings/trends — this is the html↔tui divergence guard.

import { create } from "@bufbuild/protobuf";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PanelDescriptorSchema,
  type PanelDescriptor,
} from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { StatPanelSchema } from "@savvifi/meridian-proto-ts/proto/stat_pb.js";
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
