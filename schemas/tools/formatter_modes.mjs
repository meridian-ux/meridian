// Explicit expectation inventories, not an automatic default for future modes.
export const FORMATTER_MODES = Object.freeze({
  TemporalDisplay: Object.freeze([0, 1, 2, 3]),
  PrincipalDisplay: Object.freeze([0, 1, 2, 3]),
});

export function assertFormatterModes(getEnum) {
  for (const [name, covered] of Object.entries(FORMATTER_MODES)) {
    const declared = getEnum(`meridian.ui.v1.${name}`).values.map(value => value.number).sort((a, b) => a - b);
    if (JSON.stringify(declared) !== JSON.stringify(covered)) throw new Error(`${name}: update the explicit formatting corpus for every declared mode`);
  }
}
