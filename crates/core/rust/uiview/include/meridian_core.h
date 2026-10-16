#ifndef MERIDIAN_CORE_H
#define MERIDIAN_CORE_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

/* Runtime C ABI metadata only. Semantic inputs/results are canonical protobuf:
   ValueDisplay + google.protobuf.Value -> FormattedValue, or
   StatPanel + optional google.protobuf.Value -> ComputedStat, or
   RpcCall + RequestContext -> google.protobuf.Value.
   ABI v1 limits: display/pattern 64 KiB, value/input 1 MiB, result 4 MiB,
   dynamic value nesting 64. Prost's independent wire recursion ceiling also
   applies (wrapper messages count as levels). Inputs are borrowed. Output is owned
   by Rust and must be released exactly once by meridian_core_buffer_free.
   Every pointer must be valid/aligned with nonoverlapping output storage.
   Null input + length zero is accepted; other null inputs are rejected.
   Status failure resets provided output storage to null/zero. */
#define MERIDIAN_CORE_ABI_VERSION 1
#define MERIDIAN_CORE_OK 0
#define MERIDIAN_CORE_INVALID_ARGUMENT 1
#define MERIDIAN_CORE_INVALID_PAYLOAD 2
#define MERIDIAN_CORE_LIMIT_EXCEEDED 3
#define MERIDIAN_CORE_INVALID_PATTERN 4
#define MERIDIAN_CORE_INTERNAL_FAILURE 5

uint32_t meridian_core_abi_version(void);
int32_t meridian_core_format_value(
    const uint8_t *display, size_t display_len,
    const uint8_t *value, size_t value_len,
    uint8_t has_now, double now_ms, uint8_t **output, size_t *output_len);
/* StatPanel + optional google.protobuf.Value response -> ComputedStat.
   Each input is capped at 1 MiB, nested ValueDisplay at 64 KiB, result at 4 MiB.
   has_response is 0/1; 0 requires response_len=0, 1 includes even an empty Value.
   This is pure computation, never RPC execution or admission. */
int32_t meridian_core_compute_stat(
    const uint8_t *panel, size_t panel_len, uint8_t has_response,
    const uint8_t *response, size_t response_len,
    uint8_t **output, size_t *output_len);
/* RpcCall (64 KiB) + RequestContext (1 MiB) -> google.protobuf.Value (4 MiB).
   Assembles through RequestBuilder; performs no admission or transport.
   Exact duplicate context-bag keys, nonfinite dynamic numbers, malformed or
   over-depth (64) values fail closed, with the same ownership/status contract. */
int32_t meridian_core_build_request(
    const uint8_t *call, size_t call_len,
    const uint8_t *context, size_t context_len,
    uint8_t **output, size_t *output_len);
/* Regex strings are UTF-8 byte regions, not NUL-terminated C strings.
   matched is 0/1 on success; malformed/unsupported patterns fail closed. */
int32_t meridian_core_matches_form_pattern(
    const uint8_t *pattern, size_t pattern_len,
    const uint8_t *input, size_t input_len, uint8_t *matched);
void meridian_core_buffer_free(uint8_t *pointer, size_t len);

#ifdef __cplusplus
}
#endif
#endif
