# Metrics: spacing, density, and stroke

The authoritative wire contract is `meridian.theme.v1.Metrics` in
[`theme.proto`](proto/theme.proto). Radius (tag 1) and unit (tag 2) keep their
existing meanings; their legacy zero values remain unspecified. Three additive
fields express the missing rhythm contract without moving declarations or
changing the FILE compatibility policy.

Regenerate language bindings with the canonical toolchain after updating the
proto. This is additive wire compatibility, not a promise that exhaustive
generated-struct literals remain source-compatible: Rust callers constructing
`Metrics` directly should supply the new fields or use `..Default::default()`.
Do not add parallel JSON schemas or change the FILE baseline for this addition.

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

The style-only `@savvifi/meridian-schemas/theme` entrypoint validates the three
additions without importing a renderer or the WASM core. Its `resolveMetrics`
accepts a projection of generated `Metrics` fields and a renderer's legacy unit.
The returned `spacing(factor)` handles interpolation, clamping, and density;
`strokePx` preserves absence separately from explicit zero.

Web-components map proto-JSON snake-case fields into that resolver and emit
`--mer-space-*` and `--mer-stroke`. Their base stylesheet consumes the tokens for
layout, gallery, stream, button, and record spacing and decorative borders. MUI
uses the same resolver for fractional `theme.spacing`, card borders, and CSS
variables consumed by shared React composition. Replacing a web theme restores
host-owned declarations. Semantic table dividers, tab selection, and keyboard
focus indicators do not use decorative stroke.

The reference HTML/shadcn kits receive canonical Metrics and Typography through
the actual `MeridianProvider` → panel/view path, including palette-free themes.
`themeToStyle` is applied to existing composed-view roots and passed as `style`
to a kit's existing `Chrome` root. Custom Chrome components should forward that
optional style; no additional DOM wrapper is introduced and theme replacement
does not remount controls. Reference component CSS may consume the same tokens;
this does not rewrite arbitrary host-owned Tailwind or CSS spacing rules. MUI's
mode-correct provider remains authoritative; nested Chrome inherits its roles
instead of selecting light colors again.

The public `reactWebRenderer(muiKit)` single-panel adapter installs the same MUI
theme projection through the kit's optional `ThemeProvider` boundary. It defaults
to light mode and uses a subtree-scoped baseline rather than resetting the host
page. Direct `MeridianMuiProvider` integrations retain their explicit mode and
do not acquire a second light-mode boundary. Descriptor updates preserve the
boundary and live control state; unmount leaves host declarations untouched.

Typography audit: an explicit `base_size_px` means actual body size, not MUI's
14px coefficient applied to its 16px body1 baseline. The MUI adapter now scales
variants from body1 (retaining rem-based host accessibility scaling), so an
explicit 19px body is 19px at the default 16px browser root, not 21.7143px.
Unset Typography retains the legacy MUI defaults. Existing skins with explicit
body size receive this intentional v1 correction; it is not absent-field visual
compatibility with the prior erroneous coefficient mapping.

Wire regressions, bounded resolver cases, web lifecycle tests, MUI adapter tests,
and real-Chrome gallery spacing/stroke/focus/replacement checks cover these
bindings. Final integration, cross-kit layout verification, and native
degradation documentation/tests remain required for roadmap #52 acceptance.

Terminals have character cells rather than CSS pixels. The TUI explicitly ignores
pixel Metrics: cell geometry and structural/selection styles remain unchanged.
A wire-decoded, real-gallery TestBackend regression compares every cell and style
at compact/spacious density and two terminal widths, including zero stroke. No
pixel-to-cell conversion or content removal approximates density. SwiftUI remains
the approved local panel preview: full native Metrics/layout parity is not a v1
gate, and unverified coverage stays explicit.

Before acceptance, verify old absent-field wire/JSON identity, unknown-field
round trips through old binary readers, explicit-zero stroke presence, bounded
scale/density handling, fractional spacing, partial/empty theme replacement,
host override restoration, and actual computed spacing/stroke/focus behavior.
Keep existing conformance goldens read-only. #52 and #13 remain open until the
required binding work, integration, and verification are complete.
