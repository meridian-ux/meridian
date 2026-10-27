import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildCatalog, PUBLIC_DOMAIN, validateCatalog } from "./projector_catalog.mjs";

const revision = "a".repeat(40);
const destination = "method.fixture.Service.Refresh";
const source = () => ({ entries: [
  { name: "target.list", label: "Targets", group: "Resources", kind: "list", view: {
    subjectKind: "meridian.internal.test/Target", slots: [{ panel: { table: { affordances: { items: [
      { label: "Refresh", openView: `targets/own/layouts/${destination}` },
    ] } } } }],
  } },
  { name: destination, label: "Refresh", group: "Operations", kind: "invoke", view: {
    slots: [{ panel: { form: { mode: "FORM_MODE_EDIT", fields: [{ fieldId: "name", text: { minLength: 1 } }],
      submitAffordance: { label: "Refresh", rpc: { service: "fixture.Service", method: "Refresh" } },
    } } }],
  } },
] });

test("normalizes only resource type domains and preserves exact served intent and RPCs", () => {
  const input = source(), before = JSON.stringify(input);
  const result = buildCatalog(input, revision);
  assert.equal(JSON.stringify(input), before, "source export is not mutated");
  assert.equal(result.entries[0].view.subjectKind, `${PUBLIC_DOMAIN}/Target`);
  assert.deepEqual(result.entries[1], input.entries[1]);
  assert.match(result.generatedFrom, new RegExp(revision));
  for (const invalid of ["main", "a".repeat(39), "", revision + revision]) assert.throws(() => buildCatalog(input, invalid));
});

test("strictly rejects removed view, row, and submit fields instead of dropping them", () => {
  for (const mutate of [
    b => { b.entries[0].view.actions = []; },
    b => { b.entries[0].view.slots[0].panel.table.actions = []; },
    b => { b.entries[1].view.slots[0].panel.form.submit = {}; },
    b => { b.entries[0].view.unreviewedField = true; },
  ]) { const input = source(); mutate(input); assert.throws(() => buildCatalog(input, revision)); }
});

test("does not infer destinations, execute row mutations, or normalize unknown resource types", () => {
  for (const mutate of [
    b => { b.entries.pop(); },
    b => { b.entries[1].name = "unserved"; },
    b => { b.entries[0].view.subjectKind = "meridian.internal.test/Unreviewed"; },
    b => { b.entries[0].view.slots[0].panel.table.affordances.items = [{ rpc: { service: "fixture.Service", method: "Refresh" } }]; },
    b => { delete b.entries[1].view.slots[0].panel.form.submitAffordance; },
    b => { b.entries[1].view.slots[0].panel.form.submitAffordance.rpc.method = ""; },
    b => { b.entries[1].view.slots[0].panel.form.fields = []; },
    b => { b.entries.push(b.entries[0]); },
  ]) { const input = source(); mutate(input); assert.throws(() => buildCatalog(input, revision)); }
});

test("the committed public projector catalog is strict and has a served custom request form", () => {
  const bundle = JSON.parse(readFileSync(new URL("../../packages/mui-kit/harness/proto-viewdescriptors.json", import.meta.url)));
  validateCatalog(bundle);
  assert(bundle.entries.some(entry => entry.name === "method.meridian.proto.v1.ProjectionService.RefreshTarget"));
});
