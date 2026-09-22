/** Count a string's UTF-8 bytes without allocating an encoded copy. */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        // TextEncoder encodes an unpaired surrogate as U+FFFD.
        bytes += 3;
      }
    } else {
      // Includes standalone low surrogates, which also encode as U+FFFD.
      bytes += 3;
    }
  }
  return bytes;
}
