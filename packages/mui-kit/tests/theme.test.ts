// Theme binding — a skin's TYPOGRAPHY and METRICS must survive into the MUI
// theme and the `--mer-*` custom properties, not just its palette. The kit
// previously hardcoded a system font stack and ignored Typography entirely, so a
// brand's face never reached the rendered UI; these tests pin that shut.

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ThemeSchema } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";

import {
  createMuiThemeFromConfig,
  missingThemeFonts,
  primaryFamily,
  themeProtoToCssVars,
  themeProtoToFontFaceCss,
  themeProtoToMuiTheme,
  themeProtoToThemeConfig,
} from "../src/theme.js";

// A two-face brand: a serif display over a geometric sans.
const twoFaceSkin = create(ThemeSchema, {
  id: "test-two-face",
  light: { bg: "#F4F9FC", surface: "#FFFFFF", fg: "#10222F", accent: "#00ADEF" },
  typography: {
    sans: '"Outfit", sans-serif',
    mono: '"Fira Code", monospace',
    baseSizePx: 16,
    headingWeight: 600,
    bodyWeight: 400,
    headingTracking: "-0.02",
  },
  metrics: { radiusPx: 14, unitPx: 8 },
});

describe("themeProtoToThemeConfig — typography", () => {
  it("carries the skin's faces, sizes and weights", () => {
    const config = themeProtoToThemeConfig(twoFaceSkin, "light");
    expect(config.typography.sans).toBe('"Outfit", sans-serif');
    expect(config.typography.mono).toBe('"Fira Code", monospace');
    expect(config.typography.baseSizePx).toBe(16);
    expect(config.typography.headingWeight).toBe(600);
    expect(config.typography.headingTracking).toBe("-0.02");
    expect(config.metrics).toEqual({ radiusPx: 14, unitPx: 8 });
  });

  it("falls back to `sans` when the brand declares no distinct display face", () => {
    // Single-face brands must not regress: headings just use the body face.
    const config = themeProtoToThemeConfig(twoFaceSkin, "light");
    expect(config.typography.display).toBe(config.typography.sans);
  });

  it("reads Typography.display when the proto package carries it", () => {
    // `display` post-dates this kit's pinned proto package, so the binding reads
    // it defensively. Simulate a newer package by attaching the field directly.
    // Built standalone, NOT spread from twoFaceSkin: `create` copies the init
    // shallowly, so spreading would share the `typography` message and this
    // mutation would leak into every other test's fixture.
    const withDisplay = create(ThemeSchema, {
      id: "test-display",
      typography: { sans: '"Outfit", sans-serif' },
    });
    (withDisplay.typography as unknown as { display: string }).display =
      '"IBM Plex Serif", serif';
    const config = themeProtoToThemeConfig(withDisplay, "light");
    expect(config.typography.display).toBe('"IBM Plex Serif", serif');
    expect(config.typography.sans).toBe('"Outfit", sans-serif');
  });

  it("treats unset (proto3 zero/empty) tokens as absent, not as real values", () => {
    // baseSizePx 0 / weight 0 would render an invisible UI if taken literally.
    const bare = create(ThemeSchema, { id: "bare", light: { accent: "#123456" } });
    const config = themeProtoToThemeConfig(bare, "light");
    expect(config.typography.baseSizePx).toBe(14);
    expect(config.typography.bodyWeight).toBe(400);
    expect(config.metrics.radiusPx).toBe(4);
    expect(config.typography.sans).toContain("system-ui");
  });
});

describe("createMuiThemeFromConfig", () => {
  it("sets the MUI body font from the skin, not a hardcoded stack", () => {
    const mui = themeProtoToMuiTheme(twoFaceSkin, "light");
    expect(mui.typography.fontFamily).toBe('"Outfit", sans-serif');
    expect(mui.typography.fontSize).toBe(16);
  });

  it("sets headings in the display face, with the skin's weight and tracking", () => {
    const config = themeProtoToThemeConfig(twoFaceSkin, "light");
    config.typography.display = '"IBM Plex Serif", serif';
    const mui = createMuiThemeFromConfig(config);
    for (const variant of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) {
      expect(mui.typography[variant].fontFamily).toBe('"IBM Plex Serif", serif');
      expect(mui.typography[variant].fontWeight).toBe(600);
      expect(mui.typography[variant].letterSpacing).toBe("-0.02em");
    }
    // Body text stays on the sans face — the pairing is the point.
    expect(mui.typography.fontFamily).toBe('"Outfit", sans-serif');
  });

  it("drives shape and spacing from metrics", () => {
    const mui = themeProtoToMuiTheme(twoFaceSkin, "light");
    expect(mui.shape.borderRadius).toBe(14);
    expect(mui.spacing(1)).toBe("8px");
  });
});

describe("themeProtoToFontFaceCss", () => {
  // The schema field post-dates the pinned proto package; attach it the way a
  // newer package would carry it.
  const withFonts = (fonts: unknown[]): typeof twoFaceSkin => {
    const skin = create(ThemeSchema, {
      id: "fonted",
      typography: { sans: '"Outfit", sans-serif' },
    });
    (skin.typography as unknown as { fonts: unknown[] }).fonts = fonts;
    return skin;
  };

  it("emits a rule per source, with the format inferred from the extension", () => {
    const css = themeProtoToFontFaceCss(
      withFonts([
        { family: "Outfit", srcUri: "https://cdn.example/outfit.woff2", weight: "100 900" },
      ]),
    );
    expect(css).toContain('font-family: "Outfit"');
    expect(css).toContain('url("https://cdn.example/outfit.woff2") format("woff2")');
    expect(css).toContain("font-weight: 100 900");
  });

  // Regression guard: proto3-JSON omits default values, and the web path loads
  // skins as JSON, so these keys are genuinely ABSENT in production — not just
  // empty. Reading them without a guard threw.
  it("defaults weight, style and display so a bare source is still valid CSS", () => {
    const css = themeProtoToFontFaceCss(
      withFonts([{ family: "Outfit", srcUri: "https://cdn.example/o.woff2" }]),
    );
    expect(css).toContain("font-weight: 400");
    expect(css).toContain("font-style: normal");
    // swap, not the default block: invisible text is worse than a reflow.
    expect(css).toContain("font-display: swap");
  });

  it("escapes values that would otherwise break out of url() or the rule", () => {
    const css = themeProtoToFontFaceCss(
      withFonts([{ family: 'Ev"il', srcUri: 'x.woff2") ; } body { display: none' }]),
    );
    expect(css).not.toContain("body { display: none");
    expect(css).not.toContain('Ev"il');
    // one rule in, one rule out — nothing injected alongside it
    expect(css.match(/@font-face/g)).toHaveLength(1);
  });

  it("skips sources missing a family or a URI rather than emitting broken CSS", () => {
    const css = themeProtoToFontFaceCss(
      withFonts([{ family: "Outfit" }, { srcUri: "x.woff2" }, {}]),
    );
    expect(css).toBe("");
  });

  it("is empty for a skin that declares no sources — hosts loading their own are unaffected", () => {
    expect(themeProtoToFontFaceCss(twoFaceSkin)).toBe("");
  });
});

describe("primaryFamily", () => {
  it("takes the first concrete family — the one the brand actually asks for", () => {
    expect(primaryFamily('"Outfit", -apple-system, sans-serif')).toBe("Outfit");
    expect(primaryFamily("Quicksand, Poppins, system-ui")).toBe("Quicksand");
  });

  it("returns undefined for an entirely generic stack, so nothing is warned about", () => {
    expect(primaryFamily("system-ui, -apple-system, sans-serif")).toBeUndefined();
    expect(primaryFamily("ui-monospace, monospace")).toBeUndefined();
  });
});

describe("missingThemeFonts", () => {
  it("reports a family the browser cannot resolve", () => {
    const original = document.fonts;
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { check: (spec: string) => !spec.includes("Outfit") },
    });
    try {
      expect(missingThemeFonts(twoFaceSkin)).toContain("Outfit");
    } finally {
      Object.defineProperty(document, "fonts", { configurable: true, value: original });
    }
  });

  it("reports nothing when the Font Loading API is unavailable — absence of evidence is not evidence", () => {
    const original = document.fonts;
    Object.defineProperty(document, "fonts", { configurable: true, value: undefined });
    try {
      expect(missingThemeFonts(twoFaceSkin)).toEqual([]);
    } finally {
      Object.defineProperty(document, "fonts", { configurable: true, value: original });
    }
  });

  it("does not warn about generic stacks", () => {
    const original = document.fonts;
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { check: () => false }, // nothing resolves
    });
    try {
      // A skin with no typography falls back to entirely generic stacks, so
      // there is no brand face to be missing.
      const bare = create(ThemeSchema, { id: "bare" });
      expect(missingThemeFonts(bare)).toEqual([]);
    } finally {
      Object.defineProperty(document, "fonts", { configurable: true, value: original });
    }
  });
});

describe("themeProtoToCssVars", () => {
  it("emits type and metric vars alongside the palette", () => {
    const vars = themeProtoToCssVars(twoFaceSkin, "light") as Record<string, string>;
    expect(vars["--mer-accent"]).toBe("#00ADEF");
    expect(vars["--mer-sans"]).toBe('"Outfit", sans-serif');
    expect(vars["--mer-display"]).toBe('"Outfit", sans-serif'); // no distinct face set
    expect(vars["--mer-mono"]).toBe('"Fira Code", monospace');
    expect(vars["--mer-base-size"]).toBe("16px");
    expect(vars["--mer-heading-tracking"]).toBe("-0.02em");
    expect(vars["--mer-radius"]).toBe("14px");
    expect(vars["--mer-unit"]).toBe("8px");
  });
});
