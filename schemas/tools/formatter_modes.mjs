// Explicit expectation inventories, not an automatic default for future modes.
export const FORMATTER_MODES = Object.freeze({
  TemporalDisplay: Object.freeze([0, 1, 2, 3]),
  TemporalPrecision: Object.freeze([0, 1, 2, 3]),
  PrincipalDisplay: Object.freeze([0, 1, 2, 3]),
});

export function assertFormatterModes(getEnum) {
  for (const [name, covered] of Object.entries(FORMATTER_MODES)) {
    const declared = getEnum(`meridian.ui.v1.${name}`).values.map(value => value.number).sort((a, b) => a - b);
    if (JSON.stringify(declared) !== JSON.stringify(covered)) throw new Error(`${name}: update the explicit formatting corpus for every declared mode`);
  }
}

export function assertNumberOptions(message) {
  const fields = message.fields.map(field => `${field.number}:${field.name}`).sort();
  const covered = ["1:fraction_digits", "2:currency_code", "3:omit_group_separators", "4:compact"];
  if (JSON.stringify(fields) !== JSON.stringify(covered)) throw new Error("NumberOptions: update the explicit formatting corpus for every declared option");
}
