import { create, fromBinary, toBinary, toJson } from "@bufbuild/protobuf";
import { StructSchema } from "@bufbuild/protobuf/wkt";
import { FormFieldSchema } from "@savvifi/meridian-proto-ts/proto/form_pb.js";
import { describe, expect, it, vi } from "vitest";
import { createPromptResponder, promptValues } from "./prompt_response.js";
import { defaultFormValue, defaultFormValues, validateFormValues } from "./form_values.js";
import { hasMaskedField, renderPromptTemplate } from "./prompt_template.js";
import { editMaskedSelection, maskedLines, replaceMaskedLine } from "./masked_multiline.js";

it("constructs typed recursive defaults without coercing false, zero, or strings", () => {
  const fields = [
    create(FormFieldSchema, { fieldId: "flag", kind: { case: "boolean", value: {} } }),
    create(FormFieldSchema, { fieldId: "count", kind: { case: "integer", value: {} } }),
    create(FormFieldSchema, { fieldId: "id", kind: { case: "text", value: { defaultValue: "000123" } } }),
    create(FormFieldSchema, { fieldId: "list", kind: { case: "repeated", value: { minItems: 2,
      element: { case: "scalar", value: { kind: { case: "text", value: { defaultValue: "one" } } } } } } }),
    create(FormFieldSchema, { fieldId: "object", kind: { case: "nested", value: { fields: [
      { fieldId: "ready", kind: { case: "boolean", value: { defaultValue: true } } },
    ] } } }),
  ];
  expect(defaultFormValues(fields)).toEqual({ flag: false, count: 0, id: "000123", list: ["one", "one"], object: { ready: true } });
  expect(defaultFormValue(create(FormFieldSchema, { fieldId: "map", kind: { case: "keyValueMap", value: {} } }))).toEqual({});
});

it("rejects excessive recursive defaults before allocating or truncating values", () => {
  const huge = create(FormFieldSchema, { kind: { case: "repeated", value: { minItems: 0xffffffff,
    element: { case: "object", value: {} } } } });
  expect(() => defaultFormValue(huge)).toThrow(/1000/);
  let deep = create(FormFieldSchema, { kind: { case: "text", value: {} } });
  for (let i = 0; i < 70; ++i) deep = create(FormFieldSchema, { kind: { case: "nested", value: { fields: [deep] } } });
  expect(() => defaultFormValue(deep)).toThrow(/64/);
  const rows = create(FormFieldSchema, { kind: { case: "repeated", value: { minItems: 600, element: { case: "object", value: {} } } } });
  expect(() => defaultFormValues([{ ...rows, fieldId: "a" }, { ...rows, fieldId: "b" }])).toThrow(/1000/);
});

describe("lossless masked multiline editing", () => {
  it("preserves mixed separators, blank lines, trailing lines, and Unicode", () => {
    const raw = "🦀\r\n\rnext\n";
    expect(maskedLines(raw).map(line => line.value)).toEqual(["🦀", "", "next", ""]);
    expect(replaceMaskedLine(raw, 2, "変更")).toBe("🦀\r\n\r変更\n");
    expect(maskedLines("")).toEqual([{ start: 0, end: 0, value: "" }]);
    expect(replaceMaskedLine(raw, 99, "ignored")).toBe(raw);
  });
  it.each(["\n", "\r\n", "\r"])("inherits %j for inserted breaks and joins only separator bytes", separator => {
    const raw = `ab${separator}cd`;
    expect(editMaskedSelection(raw, 0, 1, 1, "break")).toEqual({ value: `a${separator}b${separator}cd`, line: 1, column: 0 });
    expect(editMaskedSelection(raw, 1, 0, 0, "backspace")).toEqual({ value: "abcd", line: 0, column: 2 });
    expect(editMaskedSelection(raw, 0, 2, 2, "delete")).toEqual({ value: "abcd", line: 0, column: 2 });
  });
  it("replaces selected text with exact pasted separators and places the cursor after it", () => {
    expect(editMaskedSelection("a🦀z\r\nend", 0, 1, 3, "insert", "X\rY\n")).toEqual({ value: "aX\rY\nz\r\nend", line: 2, column: 0 });
    expect(editMaskedSelection("a\nb", 0, 1, 1, "insert", "\r")).toEqual({ value: "a\r\nb", line: 1, column: 0 });
  });
  it("delegates in-line deletion to native password input editing", () => {
    expect(editMaskedSelection("abc\ndef", 0, 1, 1, "backspace")).toBeUndefined();
    expect(editMaskedSelection("abc\ndef", 0, 1, 2, "delete")).toBeUndefined();
    expect(editMaskedSelection("abc", 0, 3, 3, "delete")).toBeUndefined();
    expect(editMaskedSelection("abc", 0, 0, 0, "backspace")).toBeUndefined();
  });
});

describe("shared browser prompt templates", () => {
  it("finds masked descendants in nested fields and both repeated element kinds", () => {
    const secret = create(FormFieldSchema, { kind: { case: "masked", value: {} } });
    const nested = create(FormFieldSchema, { kind: { case: "nested", value: { fields: [secret] } } });
    expect(hasMaskedField(nested)).toBe(true);
    expect(hasMaskedField(create(FormFieldSchema, { kind: { case: "repeated", value: { element: { case: "scalar", value: nested } } } }))).toBe(true);
    expect(hasMaskedField(create(FormFieldSchema, { kind: { case: "repeated", value: { element: { case: "object", value: { fields: [nested] } } } } }))).toBe(true);
    expect(hasMaskedField(create(FormFieldSchema, { kind: { case: "text", value: {} } }))).toBe(false);
    expect(hasMaskedField(undefined)).toBe(false);
  });
  it("conceals known masked slots without mutating raw values or hiding unresolved names", () => {
    const values = new Map([["secret", "a\r\nb"], ["empty", ""]]);
    expect(renderPromptTemplate("{{secret}} {{empty}} {{unknown}}", values, new Set(["secret", "empty", "unknown"]))).toEqual({ text: "•••••• •••••• {{unknown}}", unresolved: ["unknown"] });
    expect(renderPromptTemplate("{{secret}}", values).text).toBe("a\r\nb");
    expect(values.get("secret")).toBe("a\r\nb");
  });
  it("never recursively expands token-shaped slot values", () => {
    expect(renderPromptTemplate("{{a}} / {{b}}", new Map([["a", "{{b}}"], ["b", "{{a}}"]]))).toEqual({ text: "{{b}} / {{a}}", unresolved: [] });
  });
  it("matches whitespace-delimited names and treats replacement characters and markup literally", () => {
    expect(renderPromptTemplate("{{ name }} / {{a.b}}", new Map([["name", "<tag> $& 🦀"], ["a.b", "literal.name"]])).text).toBe("<tag> $& 🦀 / literal.name");
  });
  it("preserves empty values and reports unique unresolved names in template order", () => {
    expect(renderPromptTemplate("[{{empty}}] {{x}} {{y}} {{x}}", new Map([["empty", ""]]))).toEqual({ text: "[] {{x}} {{y}} {{x}}", unresolved: ["x", "y"] });
  });
  it("preserves slotless templates verbatim", () => {
    expect(renderPromptTemplate("First\nsecond", new Map())).toEqual({ text: "First\nsecond", unresolved: [] });
  });
});

describe("canonical prompt responses", () => {
  it("round-trips false, zero, empty, nested, array, and map values as protobuf", () => {
    const values = { enabled: false, count: 0, text: "", nested: { ratio: -1.5 }, items: [false, 0], map: { team: "core" } };
    expect(toJson(StructSchema, fromBinary(StructSchema, toBinary(StructSchema, promptValues(values))))).toEqual(values);
  });
  it("admits one in-flight response and completes one-shot after host acceptance", async () => {
    const response = createPromptResponder(); let resolve!: () => void;
    const handler = vi.fn(() => new Promise<void>(done => { resolve = done; }));
    const pending = response.respond(handler, "prompt", promptValues({ count: 0 }));
    await response.respond(handler, "prompt", null);
    expect(handler).toHaveBeenCalledTimes(1); expect(response.getSnapshot().busy).toBe(true);
    resolve(); await pending;
    expect(response.getSnapshot()).toEqual({ busy: false, done: true, error: "", status: "Submitted." });
    await response.respond(handler, "prompt", null); expect(handler).toHaveBeenCalledTimes(1);
  });
  it("reports host failures and permits retry with the original values", async () => {
    const response = createPromptResponder(), values = promptValues({ text: "Keep this" });
    const handler = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
    await response.respond(handler, "prompt", values); expect(response.getSnapshot().error).toBe("offline");
    expect(response.getSnapshot().done).toBe(false);
    await response.respond(handler, "prompt", values); expect(handler.mock.calls[1][1]).toBe(values);
    expect(response.getSnapshot().done).toBe(true);
  });
  it("ignores pre-disposal replies even after StrictMode-style reactivation", async () => {
    const response = createPromptResponder(); let oldResolve!: () => void, nextResolve!: () => void;
    const old = response.respond(() => new Promise<void>(done => { oldResolve = done; }), "prompt", null);
    response.dispose(); response.activate();
    const next = response.respond(() => new Promise<void>(done => { nextResolve = done; }), "prompt", promptValues({ count: 1 }));
    oldResolve(); await old; expect(response.getSnapshot().busy).toBe(true); expect(response.getSnapshot().done).toBe(false);
    nextResolve(); await next; expect(response.getSnapshot().status).toBe("Submitted.");
  });
  it("keeps cancellation distinct from a false confirmation", async () => {
    const handler = vi.fn();
    await createPromptResponder().respond(handler, "confirm", promptValues({ confirm: false }));
    const canceled = createPromptResponder(); await canceled.respond(handler, "confirm", null);
    expect(canceled.getSnapshot().status).toBe("Canceled.");
    expect(toJson(StructSchema, handler.mock.calls[0][1])).toEqual({ confirm: false }); expect(handler.mock.calls[1][1]).toBeNull();
  });
  it("makes missing handlers explicit and never responds after disposal", async () => {
    const response = createPromptResponder(); await response.respond(undefined, "prompt", null);
    expect(response.getSnapshot().error).toContain("No prompt handler");
    response.dispose(); const handler = vi.fn(); await response.respond(handler, "prompt", null); expect(handler).not.toHaveBeenCalled();
  });
});

describe("typed local form validation", () => {
  it("validates loaded enum tokens through trusted input paths without mutating descriptors", () => {
    const option = create(FormFieldSchema, { fieldId: "choice", requestField: "config.choice", kind: { case: "enumSelection", value: {
      optionsSource: { service: "fixture.Options", method: "List" }, allowedValues: ["legacy"] } } });
    const fields = [
      create(FormFieldSchema, { fieldId: "nested", requestField: "settings", kind: { case: "nested", value: { fields: [option] } } }),
      create(FormFieldSchema, { fieldId: "rows", requestField: "items", kind: { case: "repeated", value: { element: { case: "object", value: { fields: [option] } } } } }),
      create(FormFieldSchema, { fieldId: "tokens", requestField: "choices", kind: { case: "repeated", value: { element: { case: "scalar", value: option } } } }),
    ];
    const raw = { nested: { choice: "loaded" }, rows: [{ choice: "loaded" }], tokens: ["loaded"] };
    const before = fields.map(field => toBinary(FormFieldSchema, field));
    const lookup = vi.fn((_field: typeof option, _path: string) => ["loaded"]);
    expect(validateFormValues(fields, raw, lookup, "outer")).toBeUndefined();
    expect(lookup.mock.calls.map(([, path]) => path)).toEqual(["outer.settings.config.choice", "outer.items[0].config.choice", "outer.choices[0]"]);
    expect(validateFormValues(fields, raw)).toContain("select an allowed value");
    expect(validateFormValues(fields, raw, () => [])).toContain("select an allowed value");
    expect(validateFormValues(fields, raw, () => undefined)).toContain("select an allowed value");
    expect(fields.map(field => toBinary(FormFieldSchema, field))).toEqual(before);
  });
  const fields = [
    create(FormFieldSchema, { fieldId: "integer", kind: { case: "integer", value: { min: -2, max: 2 } } }),
    create(FormFieldSchema, { fieldId: "number", kind: { case: "number", value: {} } }),
    create(FormFieldSchema, { fieldId: "boolean", kind: { case: "boolean", value: {} } }),
    create(FormFieldSchema, { fieldId: "masked", kind: { case: "masked", value: { minLength: 2, pattern: "^[a-z]+$" } } }),
    create(FormFieldSchema, { fieldId: "enum", kind: { case: "enumSelection", value: { options: [{ value: "token", label: "Label" }] } } }),
    create(FormFieldSchema, { fieldId: "items", kind: { case: "repeated", value: { minItems: 1, maxItems: 2, element: { case: "scalar", value: { kind: { case: "number", value: {} } } } } } }),
    create(FormFieldSchema, { fieldId: "nested", kind: { case: "nested", value: { fields: [{ fieldId: "text", kind: { case: "text", value: {} } }] } } }),
    create(FormFieldSchema, { fieldId: "map", kind: { case: "keyValueMap", value: { maxItems: 1 } } }),
  ];
  const valid = () => ({ integer: 0, number: -1.5, boolean: false, masked: "secret", enum: "token", items: [0], nested: { text: "" }, map: { team: "core" } });
  it("accepts typed defaults without truthiness coercion", () => { expect(validateFormValues(fields, valid())).toBeUndefined(); });
  it.each([
    ["integer", 1.5], ["integer", 3], ["number", "1.5"], ["number", NaN], ["boolean", "false"],
    ["masked", "x"], ["masked", "123"], ["enum", "Label"], ["items", []], ["items", [1, 2, 3]],
    ["nested", []], ["map", { team: 1 }], ["map", { a: "1", b: "2" }],
  ])("rejects invalid %s = %j", (key, value) => { expect(validateFormValues(fields, { ...valid(), [key as string]: value })).toBeTypeOf("string"); });
  it("rejects unset kinds and malformed patterns without throwing", () => {
    expect(validateFormValues([create(FormFieldSchema, { fieldId: "missing" })], { missing: "" })).toContain("unsupported");
    expect(validateFormValues([create(FormFieldSchema, { fieldId: "text", kind: { case: "text", value: { pattern: "[" } } })], { text: "value" })).toContain("invalid pattern");
    expect(validateFormValues([create(FormFieldSchema, { fieldId: "items", kind: { case: "repeated", value: {} } })], { items: [] })).toContain("unsupported repeated element");
  });
  it("rejects unsafe integers rather than sending rounded input", () => {
    const field = create(FormFieldSchema, { fieldId: "integer", kind: { case: "integer", value: {} } });
    expect(validateFormValues([field], { integer: Number.MAX_SAFE_INTEGER })).toBeUndefined();
    expect(validateFormValues([field], { integer: Number.MAX_SAFE_INTEGER + 1 })).toContain("invalid number");
  });

  it("rejects empty or duplicate object-field IDs at every object boundary", () => {
    const leaf = create(FormFieldSchema, { fieldId: "value", kind: { case: "text", value: {} } });
    expect(validateFormValues([leaf, leaf], { value: "" })).toContain("unique");
    expect(validateFormValues([{ ...leaf, fieldId: "" }], { "": "" })).toContain("nonempty");
    for (const shape of ["nested", "repeated"] as const) {
      const field = create(FormFieldSchema, { fieldId: "outer", kind: shape === "nested"
        ? { case: "nested", value: { fields: [leaf, leaf] } }
        : { case: "repeated", value: { element: { case: "object", value: { fields: [leaf, leaf] } } } } });
      expect(validateFormValues([field], { outer: shape === "nested" ? { value: "" } : [{ value: "" }] })).toContain("unique");
    }
    // Scalar array elements are positional: their ignored field_id may be empty.
    const scalar = create(FormFieldSchema, { fieldId: "items", kind: { case: "repeated", value: {
      element: { case: "scalar", value: { kind: { case: "text", value: {} } } },
    } } });
    expect(validateFormValues([scalar], { items: [""] })).toBeUndefined();
  });

  it.each(["nested", "scalar", "object"] as const)("bounds recursive %s validation at 64 levels without throwing", shape => {
    const wrap = (levels: number, empty = false) => {
      let field = create(FormFieldSchema, { fieldId: "value", kind: empty
        ? { case: "nested", value: { fields: [] } }
        : { case: "text", value: {} } });
      let value: unknown = empty ? {} : "";
      for (let i = 0; i < levels; ++i) {
        if (shape === "nested") {
          field = create(FormFieldSchema, { fieldId: "value", kind: { case: "nested", value: { fields: [field] } } });
          value = { value };
        } else {
          field = create(FormFieldSchema, { fieldId: "value", kind: { case: "repeated", value: { element: shape === "scalar"
            ? { case: "scalar", value: field }
            : { case: "object", value: { fields: [field] } } } } });
          value = shape === "scalar" ? [value] : [{ value }];
        }
      }
      return validateFormValues([field], { value });
    };
    expect(wrap(64)).toBeUndefined();
    expect(wrap(65)).toContain("64");
    expect(wrap(200)).toContain("64");
    // Even an empty object beyond the boundary must not bypass the limit.
    expect(wrap(64, true)).toContain("64");
  });
});
