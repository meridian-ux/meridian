// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fromJson } from "@bufbuild/protobuf";
import { ThemeSchema } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";
import { applyTheme, themeToCss, themeToCssVars } from "../theme/web/theme.js";

describe("web theme Typography fields 3–5", () => {
  it("binds valid proto-JSON body size, heading weight, and body weight", () => {
    const input = { typography: { base_size_px: 19, heading_weight: 700, body_weight: 500 } };
    const decoded = fromJson(ThemeSchema, input);
    expect(decoded.typography).toMatchObject({ baseSizePx: 19, headingWeight: 700, bodyWeight: 500 });
    expect(themeToCssVars(input)).toMatchObject({
      "--mer-font-size": "19px", "--mer-heading-weight": "700", "--mer-body-weight": "500",
    });
    expect(themeToCss(input)).toContain("--mer-body-weight: 500;");
    const element = document.createElement("main");
    applyTheme(input, "dark", element);
    expect(element.style.getPropertyValue("--mer-body-weight")).toBe("500");
  });

  it("leaves zero/unset scalar typography to the stylesheet defaults", () => {
    for (const input of [{}, { typography: {} }, { typography: { body_weight: 0 } }]) {
      expect(themeToCssVars(input)).not.toHaveProperty("--mer-body-weight");
    }
  });
});

describe("web Metrics additions", () => {
  it("binds interpolated spacing, density, and intentional zero stroke", () => {
    expect(themeToCssVars({ metrics: {
      spacing_scale_px: [0, 2, 6, 12], density_scale: 0.75, stroke_px: 0,
    } })).toMatchObject({ "--mer-space-1": "1.5px", "--mer-space-1-5": "3px",
      "--mer-space-3": "9px", "--mer-space-6": "9px", "--mer-stroke": "0px" });
  });
  it("preserves legacy output without additions and ignores invalid stroke", () => {
    expect(themeToCssVars({ metrics: { unit_px: 7, radius_px: 12 } })).toEqual({
      "--mer-unit": "7px", "--mer-radius": "12px",
    });
    expect(themeToCssVars({ metrics: { stroke_px: 9 } })).not.toHaveProperty("--mer-stroke");
    expect(themeToCssVars({ metrics: { spacing_scale_px: [0, 3, 2], density_scale: 0 } })).toEqual({});
  });
  it("restores owned Metrics variables when a theme is replaced", () => {
    const element = document.createElement("main");
    element.style.setProperty("--mer-space-1", "17px");
    applyTheme({ metrics: { spacing_scale_px: [0, 2], stroke_px: 0 } }, "light", element);
    expect(element.style.getPropertyValue("--mer-space-1")).toBe("2px");
    applyTheme({}, "light", element);
    expect(element.style.getPropertyValue("--mer-space-1")).toBe("17px");
    expect(element.style.getPropertyValue("--mer-space-6")).toBe("");
    expect(element.style.getPropertyValue("--mer-stroke")).toBe("");
  });
});

describe("theme application lifecycle", () => {
  it("removes tokens omitted by a replacement theme rather than leaking the old skin", () => {
    const element = document.createElement("main");
    applyTheme({ light: { fg: "#123456" }, typography: { body_weight: 500 }, metrics: { radius_px: 12, unit_px: 9 } }, "light", element);
    applyTheme({ metrics: { unit_px: 3 } }, "light", element);
    expect(element.style.getPropertyValue("--mer-unit")).toBe("3px");
    for (const key of ["--mer-fg", "--mer-body-weight", "--mer-radius"])
      expect(element.style.getPropertyValue(key)).toBe("");
    applyTheme({}, "light", element);
    expect(element.style.getPropertyValue("--mer-unit")).toBe("");
  });

  // jsdom drops custom-property priorities; the Chrome harness verifies !important restoration.
  it("restores pre-theme host declarations across repeated replacements", () => {
    const element = document.createElement("main");
    element.style.setProperty("--mer-unit", "7px");
    element.style.color = "red";
    applyTheme({ metrics: { unit_px: 9 } }, "light", element);
    applyTheme({ metrics: { unit_px: 12 } }, "light", element);
    applyTheme({}, "light", element);
    expect(element.style.getPropertyValue("--mer-unit")).toBe("7px");
    expect(element.style.color).toBe("red");
  });

  it("does not remove a host override written after the theme application", () => {
    const element = document.createElement("main");
    applyTheme({ metrics: { unit_px: 9 } }, "light", element);
    element.style.setProperty("--mer-unit", "11px");
    applyTheme({}, "light", element);
    expect(element.style.getPropertyValue("--mer-unit")).toBe("11px");
  });

  it("restores the latest host override when a later theme temporarily owns it again", () => {
    const element = document.createElement("main");
    element.style.setProperty("--mer-unit", "7px");
    applyTheme({ metrics: { unit_px: 9 } }, "light", element);
    element.style.setProperty("--mer-unit", "11px");
    applyTheme({ metrics: { unit_px: 12 } }, "light", element);
    applyTheme({}, "light", element);
    expect(element.style.getPropertyValue("--mer-unit")).toBe("11px");
  });

  it("isolates ownership per element and leaves never-owned variables alone", () => {
    const a = document.createElement("main"), b = document.createElement("main");
    b.style.setProperty("--mer-unit", "6px");
    applyTheme({ metrics: { unit_px: 9 } }, "light", a);
    applyTheme({}, "light", b);
    expect(a.style.getPropertyValue("--mer-unit")).toBe("9px");
    expect(b.style.getPropertyValue("--mer-unit")).toBe("6px");
  });

  it("drops light-only tokens when switching to a partial dark palette", () => {
    const element = document.createElement("main");
    const theme = { light: { fg: "#112233", accent: "#334455" }, dark: { accent: "#556677" } };
    applyTheme(theme, "light", element);
    applyTheme(theme, "dark", element);
    expect(element.style.getPropertyValue("--mer-fg")).toBe("");
    expect(element.style.getPropertyValue("--mer-accent")).toBe("#556677");
  });
});
