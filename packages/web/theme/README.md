# meridian theme — the style layer

Meridian keeps **semantics and style orthogonal**, and the split is enforced by
the type system, not convention:

| Layer | Where | Carries |
|---|---|---|
| **Semantics** | `meridian.ui.v1` (`proto/panel.proto` & friends) | what a view *is and does* — **no style** |
| **Theme** | `meridian.theme.v1` (`proto/theme.proto`) | how it *looks* — **no semantics** |
| **Renderers** | `src/uiview` (web), `rust/tui`, `java/javafx`, `swift` | bind `(descriptor, theme) → native UI` |

A renderer maps a `Theme`'s tokens to its platform (web CSS custom properties,
ratatui `Style`, JavaFX CSS, SwiftUI). Because the tokens are renderer-agnostic,
**one skin is authored once and renders consistently on every surface** — e.g.
the fastverk brand identity ships as a single `Theme` (from `@brand`) and themes
the macOS app, the web console, and the TUI alike.

A `Theme` is pure data: author it as a textproto/binpb and distribute it as a
module, independent of both the descriptors and the renderers.

## Web binding (`theme/web/`)

- **`meridian.css`** — the base stylesheet. The renderer emits style-free
  `.meridian-uiview-*` DOM; this sheet gives it look *entirely* through `--mer-*`
  custom properties, with neutral fallbacks so meridian is presentable un-skinned.
- **`theme.ts`** — maps a `Theme` to those vars: `applyTheme(theme, mode)` at
  runtime, or `themeToCss(theme, mode)` to emit a static `:root { … }` block.

Stage it like any meridian asset (mirrors `@brand//mdbook:theme`):

```python
# In a consumer BUILD:
# srcs = [..., "@meridian//theme:web"]
```

```html
<link rel="stylesheet" href="/meridian/theme/meridian.css" />
<script type="module">
  import { applyTheme } from "/meridian/theme/theme.js";
  import fastverk from "/skins/fastverk.json"; // a meridian.theme.v1.Theme as JSON
  applyTheme(fastverk, "dark");
</script>
```

The `--mer-*` tokens: `--mer-{bg,surface,fg,muted,border,accent,accent-strong,
on-accent,danger,success,code-bg,code-fg}`, `--mer-font-{sans,mono,size}`,
`--mer-heading-{weight,tracking}`, `--mer-{radius,unit}`.

## Gallery and Steps layouts

The base stylesheet lays out Gallery cards in responsive columns with a 16rem
preferred minimum, collapsing to one column in narrow containers. Long values
wrap and images remain within their cards. Card spacing, surfaces, borders,
radius, and keyboard focus indicators use the existing theme tokens; descriptors
carry no layout properties. Gallery links retain native Tab/Enter navigation.
Empty galleries retain the descriptor's placeholder rather than empty cards.

Steps use a native ordered list and retain actor, narration, and action order.
Missing, rejected, or failed frame images preserve their distinct text alternative
alongside narration; identical narration and alternatives are not repeated.
Actions remain native links or buttons, and frame images scale to the container.
Hermetic Chrome checks cover wide/narrow Gallery layout, themed spacing, keyboard
access, and an actual failed Steps image request.

## Other renderers

TUI / JavaFX / Swift bindings live under their own dirs and consume the same
`Theme` (their per-language proto bindings are added next to each). The contract
they all share is `//proto:theme_proto`.
