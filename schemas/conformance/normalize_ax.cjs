// Normalize Chrome Accessibility.getFullAXTree, not authored DOM attributes.
// CDP is the protocol boundary; text uses the established golden-file format.
const PROPERTIES = new Set([
  "atomic", "autocomplete", "busy", "checked", "disabled", "editable",
  "expanded", "focusable", "hasPopup", "invalid", "level", "live", "modal",
  "multiline", "multiselectable", "orientation", "pressed", "readonly",
  "required", "selected", "valuemax", "valuemin", "valuetext",
]);
const CONTROLS = new Set(["button", "checkbox", "combobox", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio", "searchbox", "slider", "spinbutton", "switch", "tab", "textbox", "treeitem"]);

function normalizeAX(nodes) {
  const byId = new Map();
  for (const node of nodes) {
    if (byId.has(node.nodeId)) throw new Error(`Duplicate AX node ${node.nodeId}`);
    byId.set(node.nodeId, node);
  }
  const root = nodes.find(node => node.role?.value === "RootWebArea");
  if (!root) throw new Error("Computed AX tree has no RootWebArea");
  const seen = new Set(), lines = [], unnamed = [];
  function visit(id, depth) {
    const node = byId.get(id);
    if (!node) throw new Error(`Missing AX child ${id}`);
    if (seen.has(id)) throw new Error(`Repeated/cyclic AX node ${id}`);
    seen.add(id);
    const role = node.role?.value ?? "none";
    if (role === "InlineTextBox") return; // font/wrapping implementation detail
    const properties = (node.properties ?? []).filter(property => PROPERTIES.has(property.name))
      .map(property => [property.name, property.value?.value]).filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    const name = node.name?.value ?? "";
    const semantic = !node.ignored && !(role === "generic" && !name && !node.value && !properties.length);
    if (semantic) {
      const fields = [role, `name=${JSON.stringify(name)}`];
      if (node.description?.value) fields.push(`description=${JSON.stringify(node.description.value)}`);
      if (node.value?.value !== undefined) fields.push(`value=${JSON.stringify(node.value.value)}`);
      for (const [property, value] of properties) fields.push(`${property}=${JSON.stringify(value)}`);
      lines.push(`${"  ".repeat(depth)}${fields.join(" ")}`);
      if (CONTROLS.has(role) && !String(name).trim()) unnamed.push(role);
    }
    for (const child of node.childIds ?? []) visit(child, depth + Number(semantic));
  }
  visit(root.nodeId, 0);
  return { text: `${lines.join("\n")}\n`, unnamed };
}
module.exports = { normalizeAX };
