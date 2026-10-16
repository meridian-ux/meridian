// Corpus integrity, not formatter behavior: a clocked scenario must also be
// tested without a clock using identical canonical display bytes and raw data.
import assert from "node:assert/strict";

export function assertValueClockContract(cases) {
  const byName = new Map(cases.map(entry => [entry.name, entry]));
  assert.equal(byName.size, cases.length, "value-format case names must be unique");
  for (const entry of cases.filter(entry => Object.hasOwn(entry, "nowMs"))) {
    const twin = byName.get(`no-clock-${entry.name}`);
    assert.ok(twin, `${entry.name}: missing no-clock twin`);
    assert.ok(!Object.hasOwn(twin, "nowMs"), `${entry.name}: twin must omit the clock`);
    assert.equal(twin.display, entry.display, `${entry.name}: display bytes changed`);
    assert.deepEqual(twin.input, entry.input, `${entry.name}: raw input changed`);
    assert.ok(twin.expected, `${entry.name}: missing authored expectation`);
  }
}
