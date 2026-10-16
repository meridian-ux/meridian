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
