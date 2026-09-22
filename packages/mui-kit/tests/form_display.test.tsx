import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { TemporalDisplay, ValueDisplaySchema, ValueType } from "@savvifi/meridian-proto-ts/proto/value_pb.js";

import { MeridianForm } from "../src/components/form.js";

afterEach(cleanup);

describe("MeridianForm FormField.display", () => {
  it("formats disabled scalar values without leaving an inert input", () => {
    const display = create(ValueDisplaySchema, {
      type: ValueType.DATE,
      options: { case: "temporal", value: { display: TemporalDisplay.ABSOLUTE } },
    });

    render(
      <MeridianForm
        fields={[{
          key: "due",
          label: "Due",
          value: "2026-03-29",
          disabled: true,
          display,
          onChange: () => {},
        }]}
        submit={{ label: "Save", onSubmit: () => {}, disabled: true }}
      />,
    );

    expect(screen.getByText("Mar 29, 2026")).toBeTruthy();
    expect(screen.getByText("Mar 29, 2026").getAttribute("data-field-display")).toBe("due");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("keeps edit controls and raw values when the same display is declared", () => {
    const display = create(ValueDisplaySchema, { type: ValueType.DATE });

    render(
      <MeridianForm
        fields={[{
          key: "due",
          label: "Due",
          value: "2026-03-29",
          display,
          onChange: () => {},
        }]}
        submit={{ label: "Save", onSubmit: () => {} }}
      />,
    );

    expect(screen.getByDisplayValue("2026-03-29")).toBeTruthy();
    expect(screen.queryByText("Mar 29, 2026")).toBeNull();
  });
});
