// In-memory renderer scenarios from canonical ValueDisplay/FormattedValue wire
// cases. No formatter implementation is used to author expected results.
import { fromBinary, fromJson, toBinary, toJson, type JsonObject } from "@bufbuild/protobuf";
import { ValueDisplaySchema, FormattedValueSchema } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import corpus from "./core.json";

const wire = (text: string) => Uint8Array.from(atob(text), byte => byte.charCodeAt(0));
// Hostile defaults use canonical descriptors, not actual large allocations.
// Tests guard Array.from with a sentinel before rendering these inputs.
const repeatedDefault = (id: string, minItems: number): JsonObject => ({ fieldId: id,
  repeated: { minItems, scalar: { text: {} } } });
let deepDefault: JsonObject = { fieldId: "leaf", text: {} };
for (let depth = 0; depth < 66; depth++) deepDefault = { fieldId: `level-${depth}`, nested: { fields: [deepDefault] } };
export const FORM_DEFAULT_BUDGET_CASES = [
  { name: "huge-minimum", fields: [repeatedDefault("items", 4294967295)], reason: "1000 value nodes" },
  { name: "aggregate-minimum", fields: [repeatedDefault("first", 600), repeatedDefault("second", 600)], reason: "1000 value nodes" },
  { name: "deep-default", fields: [deepDefault], reason: "64 nested levels" },
].flatMap(fixture => {
  const call = { service: "fixture.Inputs", method: "Submit" };
  const fields: JsonObject[] = [{ fieldId: "choice", enumSelection: { optionsSource: {
    service: "fixture.Options", method: "List", optionsField: "items", valueField: "value" } } }, ...fixture.fields];
  const bodies: Record<string, { arm: string; body: JsonObject }> = {
    form: { arm: "form", body: { fields, mode: 2, submit: call,
      prefill: { service: "fixture.Inputs", method: "Get" } } },
    readonlyForm: { arm: "form", body: { fields, mode: 1 } },
    prompt: { arm: "prompt", body: { fields } },
    lro: { arm: "lro", body: { inputs: fields, start: { ...call, method: "Start" } } },
    llmPrompt: { arm: "llmPrompt", body: { userTemplate: "{{value}}", slots: fields.map((field, index) => ({ name: `value-${index}`, field })) } },
  };
  return Object.entries(bodies).map(([surface, { arm, body }]) => {
    const message = fromJson(ViewDescriptorSchema, { id: `${surface}-${fixture.name}`, layout: { stacked: {} },
      slots: [{ id: "content", panel: { panelId: `${surface}-${fixture.name}`, [arm]: body } }] }, { recursionLimit: 300 });
    const bytes = toBinary(ViewDescriptorSchema, message);
    return { name: `${surface}/${fixture.name}`, surface, reason: fixture.reason,
      // Test-only reader permits the deeper message so render-time limits are
      // exercised even for callers that already hold decoded descriptors.
      view: fromBinary(ViewDescriptorSchema, bytes, { recursionLimit: 300 }), bytes };
  });
});
export const OPTION_VALUES = corpus.valueFormats.map(entry => ({
  name: entry.name,
  raw: entry.input,
  nowMs: "nowMs" in entry ? Number(entry.nowMs) : undefined,
  display: fromBinary(ValueDisplaySchema, wire(entry.display)),
  expected: fromBinary(FormattedValueSchema, wire(entry.expected)),
  expectedWithoutClock: fromBinary(FormattedValueSchema, wire(("nowMs" in entry
    ? corpus.valueFormats.find(twin => twin.name === `no-clock-${entry.name}`)!
    : entry).expected)),
}));

// FormField scalar defaults carry strings/doubles, not null or heterogeneous
// lists. Preserve those corpus inputs on read surfaces rather than coercing
// them into an invented editable default. Compound kinds have their own corpus.
export const OPTION_INPUT_VALUES = OPTION_VALUES.filter(entry => entry.nowMs === undefined &&
  (typeof entry.raw === "string" || typeof entry.raw === "number"));
export const OPTION_INPUT_CASES = OPTION_INPUT_VALUES.flatMap(entry => {
  const field = { fieldId: "value", requestField: "value", label: "Declared input",
    display: toJson(ValueDisplaySchema, entry.display),
    ...(typeof entry.raw === "string" ? { text: { defaultValue: entry.raw } }
      : { number: { defaultValue: entry.raw } }) };
  const bodies: Record<string, { arm: string; body: JsonObject }> = {
    form: { arm: "form", body: { fields: [field], mode: 2, submit: { service: "fixture.Inputs", method: "Submit" } } },
    prompt: { arm: "prompt", body: { fields: [field], acceptLabel: "Submit" } },
    lro: { arm: "lro", body: { inputs: [field], start: { service: "fixture.Inputs", method: "Start" },
      metadataType: "fixture.Metadata", responseType: "fixture.Response" } },
    llmPrompt: { arm: "llmPrompt", body: { userTemplate: "Value={{value}}", slots: [{ name: "value", field }] } },
    readonlyForm: { arm: "form", body: { fields: [field], mode: 1 } },
  };
  if (typeof entry.raw === "string") bodies.readonlyMaskedForm = { arm: "form", body: { mode: 1,
    fields: [{ fieldId: "value", requestField: "value", label: "Concealed input",
      display: toJson(ValueDisplaySchema, entry.display), masked: { defaultValue: entry.raw } }] } };
  return Object.entries(bodies).map(([surface, { arm, body }]) => {
    const message = fromJson(ViewDescriptorSchema, { id: `${surface}-${entry.name}`, title: "Input fixture",
      layout: { stacked: {} }, slots: [{ id: "content", panel: { panelId: `${surface}-${entry.name}`, [arm]: body } }] });
    const bytes = toBinary(ViewDescriptorSchema, message);
    return { ...entry, name: `${surface}/${entry.name}`,
      surface: surface === "readonlyMaskedForm" ? "readonlyForm" : surface,
      expected: surface === "readonlyMaskedForm" ? { text: "••••••", title: undefined } : entry.expected,
      view: fromBinary(ViewDescriptorSchema, bytes), bytes };
  });
});

export const OPTION_READ_CASES = OPTION_VALUES.flatMap(entry => {
  const display = toJson(ValueDisplaySchema, entry.display);
  const populate = { service: "fixture.Options", method: "Get" };
  const bodies: Record<string, JsonObject> = {
    table: { populate, rowsField: "rows", columns: [{ header: "Value", fieldPath: "value", valueDisplay: display }] },
    recordCard: { populate, fields: [{ fieldId: "value", label: "Value", display, text: {} }] },
    detailHeader: { populate, title: "Fixture", descriptorRows: [{ label: "Value", sourcePath: "value", display }] },
    gallery: { populate, rowsField: "rows", card: { titleField: "value", titleDisplay: display,
      subtitleField: "value", subtitleDisplay: display, statusField: "value", statusDisplay: display } },
    resourceCards: { populate, rowsField: "rows", template: { titleField: "value", titleDisplay: display,
      subtitleField: "value", subtitleDisplay: display, statusField: "value", statusDisplay: display,
      meta: [{ label: "Value", fieldPath: "value", display }] } },
  };
  return Object.entries(bodies).map(([arm, body]) => {
    const message = fromJson(ViewDescriptorSchema, { id: `${arm}-${entry.name}`, title: "Option fixture",
      layout: { stacked: {} }, slots: [{ id: "content", panel: { panelId: `${arm}-${entry.name}`,
        title: "Option fixture", [arm]: body } }] });
    const bytes = toBinary(ViewDescriptorSchema, message);
    return { ...entry, name: `${arm}/${entry.name}`, arm,
      view: fromBinary(ViewDescriptorSchema, bytes), bytes,
      response: arm === "recordCard" || arm === "detailHeader" ? { value: entry.raw } : { rows: [{ value: entry.raw }] },
    };
  });
});

export const OPTION_CONSTRAINED_CASES = OPTION_VALUES.flatMap(entry => {
  if (entry.nowMs !== undefined) return [];
  const display = toJson(ValueDisplaySchema, entry.display);
  const variants: Array<{ arm: string; body: JsonObject; secret: boolean; expectedText: string }> = [];
  if (typeof entry.raw === "string") {
    // CopyValue explicitly preserves its legacy literal output for unspecified
    // declarations. Copy identity is always the raw string, never this label.
    const expectedText = entry.display.type === 0 ? entry.raw : entry.expected.text;
    for (const secret of [false, true]) {
      const value = { value: entry.raw, label: "Value", display, secret };
      variants.push({ arm: "copyValue", body: { value }, secret, expectedText });
      variants.push({ arm: "connectFlow", body: { endpoint: value,
        targets: [{ id: "fixture", label: "Fixture target" }], defaultTargetId: "fixture" }, secret, expectedText });
    }
  } else if (typeof entry.raw === "number") {
    variants.push({ arm: "stat", body: { label: "Value", value: entry.raw, format: 5, valueDisplay: display },
      secret: false, expectedText: entry.expected.text });
  }
  return variants.map(({ arm, body, secret, expectedText }) => {
    const message = fromJson(ViewDescriptorSchema, { id: `${arm}-${entry.name}-${secret}`, title: "Option fixture",
      layout: { stacked: {} }, slots: [{ id: "content", panel: { panelId: `${arm}-${entry.name}-${secret}`,
        title: "Option fixture", [arm]: body } }] });
    const bytes = toBinary(ViewDescriptorSchema, message);
    return { ...entry, arm, secret, expectedText, name: `${arm}/${entry.name}/${secret ? "secret" : "public"}`,
      view: fromBinary(ViewDescriptorSchema, bytes), bytes };
  });
});
