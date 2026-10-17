import { describe, expect, it } from "vitest";
import { resolveMetrics } from "./index.js";

describe("canonical Metrics style projection", () => {
  it("preserves each renderer's legacy default and fractional spacing", () => {
    expect(resolveMetrics(undefined, 4).spacing(1.5)).toBe(6);
    expect(resolveMetrics({}, 8).spacing(1.5)).toBe(12);
    expect(resolveMetrics({ unitPx: 3 }, 8).spacing(-2)).toBe(-6);
    expect(resolveMetrics({ unitPx: 0 }, 8).spacing(1)).toBe(8);
    expect(resolveMetrics({}, 4).strokePx).toBeUndefined();
    expect(resolveMetrics({}, 4).hasSpacing).toBe(false);
  });
  it("interpolates, clamps, and applies density once", () => {
    const resolved = resolveMetrics({ spacingScalePx: [0, 2, 6, 12], densityScale: 0.75 }, 8);
    expect([0, 1, 1.5, 3, 99, -1.5].map(resolved.spacing)).toEqual([0, 1.5, 3, 9, 9, -3]);
  });
  it.each([[], [0], [1, 2], [0, -1], [0, 1.5], [0, 1025], [0, NaN],
    [0, Infinity], [0, 4, 2], Array(18).fill(0)].map(scale => ({ scale })))("rejects invalid scale $scale", ({ scale }) => {
    expect(resolveMetrics({ spacingScalePx: scale, densityScale: 2 }, 4).spacing(1.5)).toBe(12);
  });
  it("accepts inclusive limits and repeated scale entries", () => {
    expect(resolveMetrics({ spacingScalePx: [0, 0, 1024], densityScale: 0.5 }, 4).spacing(2)).toBe(512);
    expect(resolveMetrics({ strokePx: 8 }, 4).strokePx).toBe(8);
    expect(resolveMetrics({ spacingScalePx: Array(17).fill(0) }, 4).spacing(99)).toBe(0);
  });
  it.each([0, -1, 0.49, 2.01, Infinity, NaN])("falls back independently for density %s", densityScale => {
    const resolved = resolveMetrics({ spacingScalePx: [0, 3], densityScale, strokePx: 0 }, 8);
    expect(resolved.spacing(1)).toBe(3);
    expect(resolved.hasSpacing).toBe(true);
    expect(resolved.strokePx).toBe(0);
  });
  it.each([-1, 0.5, 9, Infinity, NaN])("rejects invalid stroke %s without discarding spacing", strokePx => {
    const resolved = resolveMetrics({ spacingScalePx: [0, 3], strokePx }, 8);
    expect(resolved.spacing(1)).toBe(3);
    expect(resolved.strokePx).toBeUndefined();
  });
  it("snapshots mutable input and rejects nonfinite runtime factors", () => {
    const spacingScalePx = [0, 4];
    const resolved = resolveMetrics({ spacingScalePx }, 8);
    spacingScalePx[1] = 99;
    expect(resolved.spacing(1)).toBe(4);
    for (const factor of [NaN, Infinity, -Infinity]) expect(() => resolved.spacing(factor)).toThrow(RangeError);
  });
});
