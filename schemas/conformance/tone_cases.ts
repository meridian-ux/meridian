import { ToneSchema } from "@savvifi/meridian-proto-ts/proto/value_pb.js";
import { PaletteSchema } from "@savvifi/meridian-proto-ts/proto/theme_pb.js";

// Test-only, in-process metadata derived from canonical generated descriptors.
// Expected roles do not call the production projection under test. A new Tone
// must have a matching Palette field and renderer assertions, not be skipped by
// an old numeric range. UNSPECIFIED has the explicit neutral fallback.
export function deriveToneCases(values = ToneSchema.values, fields = PaletteSchema.fields) {
  return values.map(entry => {
    const role = entry.name === "TONE_UNSPECIFIED" ? "neutral" : entry.name.replace(/^TONE_/, "").toLowerCase();
    const palette = role === "neutral" ? "fg" : role;
    if (!fields.some(field => field.name === palette)) {
      throw new Error(`${entry.name} has no Palette.${palette} binding`);
    }
    return { tone: entry.number, role, palette };
  });
}

export const toneCases = deriveToneCases();
