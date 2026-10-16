// In-memory renderer scenarios from canonical ValueDisplay/FormattedValue wire
// cases. No formatter implementation is used to author expected results.
import { fromBinary, fromJson, toBinary, toJson, type JsonObject } from "@bufbuild/protobuf";
import { ValueDisplaySchema, FormattedValueSchema } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { ViewDescriptorSchema } from "@savvifi/meridian-proto-ts/proto/view_pb.js";
import corpus from "./core.json";

const wire = (text: string) => Uint8Array.from(atob(text), byte => byte.charCodeAt(0));
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
