// EnumSelection options — labels, and the precedence form.proto declares.
//
// REGRESSION for a bug found in a browser, not in a test: a producer emitted
// `options` (schemas 0.21.0, carrying each value's localized label and tone),
// this kit read only `allowedValues`, and the dropdown rendered EMPTY with no
// error anywhere. The renderer looked broken; the descriptor was fine.
//
// Pure tests protect precedence and fallback; a focused interaction test covers
// tone rendering and verifies that styled labels never replace submitted tokens.

import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ValueTone } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { FormPanelSchema, PanelDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/panel_pb.js";
import { PanelRenderer } from "@savvifi/meridian-web-react";
import { MeridianMuiProvider } from "../src/provider.js";

import { EnumSelectionSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";

import { enumOptions } from "../src/mui_kit.js";

afterEach(cleanup);

describe("EnumSelection options", () => {
  it("renders authored tones in selected labels and menus while submitting raw tokens", async () => {
    const invoke = vi.fn(async () => ({}));
    const panel = create(PanelDescriptorSchema, { body: { case: "form", value: create(FormPanelSchema, {
      mode: 2, submit: { service: "demo.Form", method: "Save" },
      fields: [{ fieldId: "state", label: "State", kind: { case: "enumSelection", value: {
        defaultValue: "ready", allowedValues: ["ignored"], options: [
          { value: "ready", label: "Ready", tone: ValueTone.SUCCESS },
          { value: "blocked", label: "Blocked", tone: ValueTone.DANGER },
          { value: "plain", label: "", tone: 999 as ValueTone },
        ],
      } } }],
    }) } });
    render(<MeridianMuiProvider invoker={{ invoke }} admission={{ mutations: ["*"] }}><PanelRenderer descriptor={panel} /></MeridianMuiProvider>);
    expect(screen.getByRole("combobox").querySelector('[data-value-tone="success"]')?.textContent).toBe("Ready");
    fireEvent.mouseDown(screen.getByRole("combobox"));
    const blocked = await screen.findByRole("option", { name: "Blocked" });
    const toned = blocked.querySelector('[data-value-tone="danger"]')!;
    expect(getComputedStyle(toned).color).not.toBe(getComputedStyle(blocked).color);
    expect(screen.getByRole("option", { name: "plain" }).querySelector("[data-value-tone]")).toBeNull();
    fireEvent.click(blocked);
    expect(screen.getByRole("combobox").querySelector('[data-value-tone="danger"]')?.textContent).toBe("Blocked");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("demo.Form", "Save", { state: "blocked" }));
  });

  it("renders the producer's labels, and keeps the stored token as the value", () => {
    const got = enumOptions(
      create(EnumSelectionSchema, {
        options: [
          { value: "dev", label: "Development" },
          { value: "prod", label: "Production" },
        ],
      }),
    );
    expect(got).toEqual([
      { value: "dev", label: "Development" },
      { value: "prod", label: "Production" },
    ]);
  });

  // form.proto: "when both are set, `options` wins and `allowed_values` is
  // ignored, so a producer can populate both during a migration without
  // renderers double-listing." Reading allowedValues first would double-list.
  it("options WINS when both are set", () => {
    const got = enumOptions(
      create(EnumSelectionSchema, {
        allowedValues: ["dev", "prod"],
        options: [{ value: "dev", label: "Development" }],
      }),
    );
    expect(got).toEqual([{ value: "dev", label: "Development" }]);
  });

  // label is OPTIONAL and "falls back to `value` when empty" — a blank entry is
  // worse than a raw token, because it cannot be picked out of a list.
  it("falls back to the value when a label is empty", () => {
    expect(enumOptions(create(EnumSelectionSchema, { options: [{ value: "staging" }] }))).toEqual([
      { value: "staging", label: "staging" },
    ]);
  });

  // allowed_values is the pre-0.21 form and producers have not all migrated.
  it("still renders allowedValues when options is unset", () => {
    expect(enumOptions(create(EnumSelectionSchema, { allowedValues: ["dev", "prod"] }))).toEqual([
      { value: "dev", label: "dev" },
      { value: "prod", label: "prod" },
    ]);
  });

  it("an empty selection yields no options rather than throwing", () => {
    expect(enumOptions(create(EnumSelectionSchema, {}))).toEqual([]);
  });
});
