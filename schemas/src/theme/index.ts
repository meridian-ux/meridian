// Style-only projection of the canonical proto. No renderer, DOM, or WASM load.
import type { Metrics } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";

type MetricInput = Partial<Pick<Metrics, "unitPx" | "spacingScalePx" | "densityScale" | "strokePx">>;

/** Runtime style resolver; not a serialized boundary type. Legacy defaults
 * remain renderer-owned (WC uses 4px; MUI uses 8px). Invalid additions fall
 * back independently, so a bad density never discards a valid spacing scale. */
export function resolveMetrics(metrics: MetricInput | undefined, legacyUnitPx: number) {
  const source = metrics?.spacingScalePx;
  const scale = source && source.length >= 2 && source.length <= 17 && source[0] === 0 &&
    source.every((value, index) => Number.isInteger(value) && value >= 0 && value <= 1024 &&
      (index === 0 || value >= source[index - 1])) ? [...source] : undefined;
  const candidateDensity = metrics?.densityScale;
  const validDensity = candidateDensity !== undefined && Number.isFinite(candidateDensity) &&
    candidateDensity >= 0.5 && candidateDensity <= 2;
  const density = validDensity ? candidateDensity : 1;
  const candidateStroke = metrics?.strokePx;
  const strokePx = candidateStroke !== undefined && Number.isInteger(candidateStroke) &&
    candidateStroke >= 0 && candidateStroke <= 8 ? candidateStroke : undefined;
  const unit = metrics?.unitPx;
  const unitPx = unit !== undefined && Number.isFinite(unit) && unit > 0 ? unit : legacyUnitPx;

  return {
    hasSpacing: scale !== undefined || validDensity,
    strokePx,
    spacing(factor: number): number {
      if (!Number.isFinite(factor)) throw new RangeError("Spacing factor must be finite");
      if (!scale) return factor * unitPx * density;
      const position = Math.min(Math.abs(factor), scale.length - 1);
      const lower = Math.floor(position), upper = Math.ceil(position);
      const value = scale[lower] + (scale[upper] - scale[lower]) * (position - lower);
      return (factor < 0 ? -value : value) * density;
    },
  };
}
