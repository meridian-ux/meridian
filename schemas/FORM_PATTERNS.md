# Form pattern contract for v1

`TextInput.pattern` and `MaskedInput.pattern` use the Rust `regex` crate's syntax
and default Unicode semantics on every native and browser form surface. The
browser executes the actual pinned Rust core through its embedded synchronous
WASM module; JavaScript `RegExp` is not an alternative implementation or fallback.
Nested and repeated fields follow the same rule. The regex crate's default
compilation limits and worst-case search bound apply to untrusted patterns.

A match anywhere in the string is sufficient. Use `^...$` for a whole-value
constraint; patterns are not implicitly anchored. An empty pattern imposes no
constraint. Length checks still count UTF-16 code units and run before patterns;
this change does not redefine min/max length or normalize/coerce submitted values.

## Migrating browser-only patterns

- `\d` includes Unicode decimal digits. Use `[0-9]` for an ASCII identifier.
- `\w` is Unicode-aware. Use an explicit ASCII class for ASCII-only word rules.
- `.` consumes a Unicode scalar, not one JavaScript UTF-16 code unit.
- `$` means the end of the input, not a position before its final newline.
  `(?m)` explicitly enables line-oriented anchors when intended.
- Lookaround and backreferences are unsupported. Replace them with an equivalent
  supported pattern or explicit domain validation. Do not silently remove a
  constraint or fall back to browser regex evaluation.
- Rust inline flags such as `(?i)` and Unicode classes are supported. Do not
  pass JavaScript `/.../flags` wrapper syntax as a pattern string.

Malformed, unsupported, or excessive compiled patterns reject submission with
an invalid-pattern error. A valid pattern that does not match uses the authored
`pattern_error_msg` if present, otherwise the generic invalid-value error.
Invalid-pattern diagnostics do not echo the submitted text, including secrets.
No callback or RPC is authorized by matching a pattern; host admission remains
independent. Remote enum membership continues to use the trusted loaded registry.

The proto-defined `CoreCorpus.form_patterns` fixtures pin the same native,
actual-WASM, and shared browser-field results. Tests also reject missing runtime
capability and prove that browser field validation does not invoke JavaScript
`RegExp`. Unsupported old browser patterns are a deliberate v1 contract migration,
not a claim of compatibility with every previously accepted browser descriptor.

Reference: [Rust regex syntax, Unicode and untrusted input](https://docs.rs/regex/).
