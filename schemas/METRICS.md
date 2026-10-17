# Metrics: spacing, density, and stroke

The authoritative wire contract is `meridian.theme.v1.Metrics` in
[`theme.proto`](proto/theme.proto). Radius (tag 1) and unit (tag 2) keep their
existing meanings; their legacy zero values remain unspecified. Three additive
fields express the missing rhythm contract without moving declarations or
changing the FILE compatibility policy.

| Field | Contract | Absent or invalid |
|---|---|---|
| `spacing_scale_px` (3) | Indexed CSS-reference-pixel steps; 2–17 nondecreasing uint32 entries, first entry zero, every entry at most 1024 | Use existing unit-based spacing |
| `density_scale` (4) | Optional finite multiplier in [0.5, 2]; 1 regular, lower compact, higher spacious | Multiplier 1 |
| `stroke_px` (5) | Optional decorative border width in [0, 8]; explicit zero is borderless | Preserve the component's existing stroke |

Wire decoding preserves values; each binding validates these rendering bounds
before applying them. Invalid fields fall back independently, not by discarding
the entire theme. A serialized zero is not absence for either optional scalar.

For a valid scale, integer spacing factors select entries and fractional factors
linearly interpolate adjacent entries. Factors beyond the final index clamp to
that final value. Negative factors negate the corresponding positive result
where the property accepts negative spacing. Without a valid scale, use the
existing unit and renderer fallback. Multiply resolved spacing by density only
once. Density changes space, not text, icons, radii, border width, identity,
reading order, focus, validation, or permission to invoke an action.

Existing skins that omit the new fields keep their existing appearance. In
particular, the web-components and MUI legacy unit/radius defaults differ; this
addition does not silently rewrite either default. Explicit scale entries are
absolute reference-pixel values shared across pixel-capable bindings. Focus
indicators, selected-state affordances, and semantically necessary separators
must remain perceptible even when decorative stroke is explicitly zero.

## Realization and verification status

The schema and wire-compatibility regressions are the first implementation
slice for roadmap #52, not its completion. CSS, shared React composition, MUI,
theme-replacement ownership, and real-browser computed-style proofs still need
to adopt this contract. Exporting unused variables is not adoption.

Terminals have character cells rather than CSS pixels. Their binding must state
the supported semantic realization or explicit degradation; it must not guess a
pixel-to-cell conversion or drop content to approximate density. SwiftUI remains
the approved local panel preview: full native Metrics/layout parity is not a v1
gate, and unverified coverage stays explicit.

Before acceptance, verify old absent-field wire/JSON identity, unknown-field
round trips through old binary readers, explicit-zero stroke presence, bounded
scale/density handling, fractional spacing, partial/empty theme replacement,
host override restoration, and actual computed spacing/stroke/focus behavior.
Keep existing conformance goldens read-only. #52 and #13 remain open until the
required binding work, integration, and verification are complete.
