#include "meridian_core.h"
#include <assert.h>
#include <string.h>

/* Real C compiler/linker/ownership smoke. No second schema: the empty protobuf
   encodings below are default ValueDisplay and google.protobuf.Value messages. */
int main(void) {
  assert(meridian_core_abi_version() == MERIDIAN_CORE_ABI_VERSION);
  uint8_t *output = NULL;
  size_t length = 0;
  assert(meridian_core_format_value(NULL, 0, NULL, 0, 0, 0, &output, &length) == MERIDIAN_CORE_OK);
  const uint8_t expected[] = {0x0a, 3, 0xe2, 0x80, 0x94}; /* FormattedValue: em dash */
  assert(length == sizeof(expected));
  assert(memcmp(output, expected, length) == 0);
  meridian_core_buffer_free(output, length);
  assert(meridian_core_compute_stat(NULL, 0, 0, NULL, 0, &output, &length) == MERIDIAN_CORE_OK);
  const uint8_t stat_expected[] = {0x0a, 1, '0', 0x20, 1}; /* ComputedStat value=0, neutral */
  assert(length == sizeof(stat_expected));
  assert(memcmp(output, stat_expected, length) == 0);
  meridian_core_buffer_free(output, length);
  const uint8_t malformed[] = {0xff};
  assert(meridian_core_format_value(malformed, 1, NULL, 0, 0, 0, &output, &length) == MERIDIAN_CORE_INVALID_PAYLOAD);
  assert(output == NULL && length == 0);
  length = 999;
  assert(meridian_core_format_value(NULL, 0, NULL, 0, 0, 0, NULL, &length) == MERIDIAN_CORE_INVALID_ARGUMENT);
  assert(length == 0);
  uint8_t matched = 99;
  const uint8_t pattern[] = "^\\d+$";
  const uint8_t input[] = "١٢";
  assert(meridian_core_matches_form_pattern(pattern, sizeof(pattern) - 1, input, sizeof(input) - 1, &matched) == MERIDIAN_CORE_OK);
  assert(matched == 1);
  const uint8_t invalid[] = "(?=a)";
  assert(meridian_core_matches_form_pattern(invalid, sizeof(invalid) - 1, input, sizeof(input) - 1, &matched) == MERIDIAN_CORE_INVALID_PATTERN);
  assert(matched == 0);
  return 0;
}
