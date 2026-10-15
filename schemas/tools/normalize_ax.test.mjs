import assert from "node:assert/strict";
import test from "node:test";
import normalizer from "../conformance/normalize_ax.cjs";
const { normalizeAX } = normalizer;
const node = (id, role, name = "", children = [], extra = {}) => ({ nodeId: id, ignored: false, role: { value: role }, name: { value: name }, childIds: children, ...extra });
test("computed names, values, descriptions and states survive without backend IDs", () => {
  const tree = normalizeAX([node("root", "RootWebArea", "Fixture", ["control"]), node("control", "checkbox", "Resolved label", [], {
    backendDOMNodeId: 123, description: { value: "Computed description" }, value: { value: "raw" },
    properties: [{ name: "checked", value: { value: false } }, { name: "labelledby", value: { relatedNodes: [{ backendDOMNodeId: 456 }] } }],
  })]);
  assert.match(tree.text, /checkbox name="Resolved label" description="Computed description" value="raw" checked=false/);
  assert.doesNotMatch(tree.text, /123|456|labelledby/);
  assert.deepEqual(tree.unnamed, []);
});
test("ignored/layout wrappers flatten while implicit roles and computed text remain", () => {
  const tree = normalizeAX([node("r", "RootWebArea", "", ["g"]), node("g", "generic", "", ["i"]),
    node("i", "none", "", ["p"], { ignored: true }), node("p", "StaticText", "Hello", ["inline"]), node("inline", "InlineTextBox", "Hello")]);
  assert.equal(tree.text, 'RootWebArea name=""\n  StaticText name="Hello"\n');
});
test("unnamed interactive controls are reported rather than removed", () => {
  for (const role of ["button", "checkbox", "combobox", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio", "searchbox", "slider", "spinbutton", "switch", "tab", "textbox", "treeitem"])
    assert.deepEqual(normalizeAX([node("r", "RootWebArea", "", ["b"]), node("b", role)]).unnamed, [role]);
});
test("missing children, cycles, duplicates, and absent roots fail closed", () => {
  assert.throws(() => normalizeAX([]), /RootWebArea/);
  assert.throws(() => normalizeAX([node("r", "RootWebArea", "", ["missing"])]), /Missing AX child/);
  assert.throws(() => normalizeAX([node("r", "RootWebArea", "", ["r"])]), /cyclic/);
  assert.throws(() => normalizeAX([node("r", "RootWebArea"), node("r", "button")]), /Duplicate/);
});
