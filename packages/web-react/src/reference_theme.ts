// Shared reference-kit projection. Serialized skins remain canonical Theme protos.
import type { CSSProperties } from "react";
import type { Theme } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
import { resolveMetrics } from "@savvifi/meridian-schemas/theme";

export function referenceThemeStyle(theme: Theme | undefined): CSSProperties {
  if (!theme) return {};
  const vars: Record<string, string> = {};
  const palette = theme.dark ?? theme.light;
  for (const [field, token] of [
    ["bg", "bg"], ["surface", "surface"], ["fg", "fg"], ["muted", "muted"],
    ["border", "border"], ["accent", "accent"], ["accentStrong", "accent-strong"],
    ["onAccent", "on-accent"], ["danger", "danger"], ["success", "success"],
    ["warning", "warning"], ["info", "info"], ["codeBg", "code-bg"], ["codeFg", "code-fg"],
  ] as const) if (palette?.[field]) vars[`--mer-${token}`] = palette[field];
  const metrics = theme.metrics;
  if (metrics?.radiusPx) vars["--mer-radius"] = `${metrics.radiusPx}px`;
  if (metrics?.unitPx) vars["--mer-unit"] = `${metrics.unitPx}px`;
  const resolved = resolveMetrics(metrics, 4);
  if (resolved.hasSpacing) for (const factor of [1, 1.5, 2, 3, 3.5, 4, 5, 6])
    vars[`--mer-space-${String(factor).replace(".", "-")}`] = `${resolved.spacing(factor)}px`;
  if (resolved.strokePx !== undefined) vars["--mer-stroke"] = `${resolved.strokePx}px`;
  const typography = theme.typography;
  return {
    ...vars,
    ...(metrics?.radiusPx ? { borderRadius: metrics.radiusPx } : {}),
    ...(resolved.strokePx !== undefined ? { borderWidth: resolved.strokePx } : {}),
    ...(typography?.sans ? { fontFamily: typography.sans } : {}),
    ...(typography?.baseSizePx ? { fontSize: typography.baseSizePx } : {}),
    ...(typography?.bodyWeight ? { fontWeight: typography.bodyWeight } : {}),
  };
}

export function referenceHeadingStyle(theme: Theme | undefined): CSSProperties | undefined {
  const typography = theme?.typography;
  return typography?.headingWeight ? { fontWeight: typography.headingWeight } : undefined;
}
