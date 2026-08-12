# meridian-brand

The **meridian-ux** visual identity as a publishable Bazel module — meridian
CONTENT (the refracted-light "M" mark, the palette, the wordmark text, and the
`meridian.theme.v1` skin) consuming the reusable brand pipeline from
[`brando`](https://github.com/mattmarshall/brando). brando holds the machinery;
this repo holds only what is meridian-ux.

Sibling of `fastverk/brand` (midnight / amber) and `tomato-bazel/brand` (soil /
tomato / vine). meridian's signature is the cool **azure → violet**, a band of
the same refraction spectrum the sibling accents sit in.

## The identity

- **Mark** — an **M traced by a single refracted light beam**. Four beam
  segments disperse across the spectrum (cyan · azure · violet · green) with a
  bright vertex where the light concentrates. The icon form is the solid,
  refracted M; the web sites add a glow/bloom treatment on the same letterform.
- **Color** — ink `#131419` · cool paper `#E9EAF3` · azure `#6E8BFF` → violet
  `#9A7CF0`, plus the cyan/green spectrum ends.
- **Type** — Space Grotesk (display / UI), system mono as a first-class voice.
- **Skin** — `skins/meridian.textpb`, a `meridian.theme.v1.Theme`. Because
  meridian-ux *is* the framework that renders themes, its own identity ships as
  a first-class Theme, not a bolt-on.

## What it produces

| target | output |
|--------|--------|
| `//skins:meridian` | `meridian.binpb` (validated `meridian.theme.v1.Theme`) + `meridian.json` (proto3-JSON, for the web `applyTheme`) |
| `//gen:svgs` | `meridian_mark.svg`, `meridian_light_mark.svg` (composite mark) |
| `//icons:icon_set` | per-size PNGs (16…1024) + `.icns` / `.ico`, dark + light |
| `//wordmark:wordmark_set` | wordmark + mark/wordmark lockups (SVG + PNG), dark + light + tagline |
| `//:all` | the skin + vectors + icons + wordmark |

## Build

```sh
bazel build //skins:meridian     # the skin — the load-bearing artifact
bazel build //gen:svgs           # the mark SVGs
bazel build //...                # everything (icons rasterize via Pillow)
```

Resolves `brando` + `meridian` from the fastverk registry (`.bazelrc`); the mark
generator + rasterizer run hermetically under `rules_python` (shapely / pillow).

## Publish (follow-up)

Tag + push to `meridian-ux/brand`, then register `meridian_brand` in the
`tomato-bazel/bazel-registry` (byte-identical `MODULE.bazel` + `source.json` +
`metadata.json`), the same flow the sibling brands use. Consumers then
`bazel_dep(name = "meridian_brand", version = ...)` and reference
`@meridian_brand//skins:meridian` (the skin) or the mark/wordmark artifacts.
