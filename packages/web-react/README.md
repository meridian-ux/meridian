# meridian-web-react

Standalone prompts return values through the optional `onPromptResponse` prop
on `MeridianProvider` (also forwarded by `reactWebRenderer` mount options).
The callback receives `(panelId, Struct | null)`: canonical protobuf field values,
or a confirmation bool keyed by panel ID; `null` means cancellation. It may
return a promise. Inputs survive failed callbacks, duplicate pending submissions
are blocked, and descriptor changes/unmounts isolate late replies. A prompt is
one-shot after host acceptance. Missing handlers are visible, not silent no-ops.
The host remains responsible for authorizing any external follow-up action.

The **kit-agnostic React renderer tier** of the meridian design language — a
public peer renderer implementing the framework-neutral
[`WebRenderer` seam](https://github.com/meridian-ux/meridian-schemas) over a
swappable **`ComponentKit`**.

It renders `meridian.ui.v1` `PanelDescriptor`s (from `@savvifi/meridian-proto-ts`)
through whatever component kit you plug in — MUI, shadcn, plain HTML — without the
renderer core knowing about any of them:

```
PanelDescriptor + Theme ──▶ reactWebRenderer(kit) ──▶ <PanelRenderer> ──▶ kit.{Table,Form,Lro,…}
   (@savvifi/meridian-proto-ts)        │                                         ▲ swap me
   seam: @savvifi/meridian-schemas ────┘                                  mui-kit · shadcn-kit · htmlKit
```

- **`MeridianProvider`** + hooks (`useMeridianTheme`, `useRpcInvoker`, `useMutationRpcInvoker`, `useComponentKit`, `useAdhocHandler`)
- **`PanelRenderer`** — oneof dispatch to `kit.*`
- **`ComponentKit`** interface + `htmlKit` (the bundled reference kit) + `reactWebRenderer(kit)`

The design language reaches this repo purely as **npm packages**
(`@savvifi/meridian-schemas`, `@savvifi/meridian-proto-ts`) — there is no Bazel
module dependency on meridian-schemas. React is a peer dependency.

### Record loading and retry

`useRecord` resolves detail-header, record-card, and gallery populate calls from
the current view subject plus available literal, selection, nested, and ambient
row bindings. Unavailable form, signal, and host-context values remain omitted.
The effective request and transport identify each fetch; equivalent reconstructed
descriptors do not refetch. Changed subjects/transports, disabled calls, retries,
and late replies cannot expose an older request's record.

The bundled HTML and shadcn detail-header/record-card components announce loading
with `role="status"` and failures with `role="alert"`. Their Retry record button
uses `useRecord().reload()` through the same host/admission seam. Synchronous
throws and non-object responses are failures, not apparently successful records.
No populate means an ambient repeated-view record, or an inert authored fallback,
never leftover fetched data.

SSR seeds remain service/method-keyed one-row pages. They are scoped to the
initial request/transport and survive StrictMode effect replay without refetch.
Calls with live bindings, including nested selections or row fields, cannot use
these unscoped seeds. A changed request fetches normally rather than reusing the
old subject's seed. The seed format itself is unchanged.

### Specialized Terminal support

`Terminal` is an optional kit slot. The bundled HTML, shadcn, and MUI kits
display safe connection metadata, not an interactive PTY. Their Terminal cells
are therefore explicitly `not-applicable` for the interactive specialization;
web-components owns the xterm.js implementation. This preserves useful
degradation without counting a connection link as PTY parity.

If a host omits `Terminal` or `Stream`, `PanelRenderer` invokes that kit's
`Fallback` with the original descriptor. It does not bypass a host's fallback
policy with a renderer-owned terminal view.

### Stream transcripts

Pass `streamSnapshots` to `MeridianProvider` or `MeridianMuiProvider`, keyed by
`PanelDescriptor.panel_id`. Each snapshot is an array of generated `StreamFrame`
protobuf messages whose `data_json` contains a JSON string or structured event.
All three kits render the same bounded transcript, including during server-side
rendering: `line_field` selects structured text, `max_lines` retains the tail,
and `max_bytes` tightens the 64 MiB ceiling. Invalid events are ignored; content
is escaped, not interpreted as HTML. Replacing the snapshot updates the content.
Without a snapshot, the authored placeholder remains visible.

This is the static degradation rung, not a live subscription API. Live transport
still requires a host-provided Stream component; snapshots do not invoke RPCs.

### Admission

Descriptor reads remain open by default so populate calls continue to work, but
descriptor-originated mutations are denied unless the host names the allowed
service/methods. Pass the policy to `MeridianProvider` (or use
`MountOptions.admission` through `reactWebRenderer`):

```tsx
<MeridianProvider
  invoker={rpcInvoker}
  kit={kit}
  adhoc={{}}
  admission={{
    mutations: ["demo.catalog.v1.Product/DeleteProduct"],
    onDenied: (denial) => logger.warn(denial.reason),
  }}
>
  <ViewRenderer view={viewDescriptor} />
</MeridianProvider>
```

Use `admission: "unrestricted"` only for hosts rendering exclusively
first-party descriptors. `useRpcInvoker()` is the read-tier transport;
action and submit implementations use `useMutationRpcInvoker()` so the tier
cannot be selected by descriptor data.

`buildActionBindingRequest` additionally admits JSON request construction before
copying referenced row/selection data. One invocation shares a conservative
4 MiB work budget, a 64-level depth limit, and a 65,536-node ceiling. Dotted paths
and source names are limited to 64 KiB. String accounting reserves six bytes per
UTF-16 unit before copying to cover JSON escaping. Repeated references consume
the budget on every copy; overlapping writes mutate only an owned request tree.
Borrowed rows and prior requests are never mutated.

Unsafe or empty assignment path segments, cycles, accessors, nonfinite numbers,
and non-JSON runtime values reject the **whole request**. Raw own-data keys such
as `__proto__` inside a copied JSON value remain data, not prototype writes.
Unavailable form/signal/host context and unset selection sources remain omitted;
available zero, false, and authored empty strings remain unchanged. Direct users
of this helper must catch rejection and must not dispatch an empty or partial
fallback request.

The shared view/table actions and resource-card actions use this path, as do
`useRecord` and fetched Stat requests. Invalid record/Stat requests expose an
error without dispatch or consumption of an SSR seed. Resource-card controls
report generic, accessible failures, preserve confirmation and retry, and ignore
obsolete completions. Admission authorization still applies independently.

`buildBindingRequest` now shares this admission policy for populate literals,
nested bindings, and live selection (no row/form/signal context is invented).
Authored empty literals are preserved; unset selections remain omitted.
`usePagedRows` admits bindings and pagination cumulatively into the same owned
tree, preserving sibling scope fields such as `page.tenant` when adding
`page.offset`/`page.limit`. Invalid paths and unsafe offset arithmetic reject
before transport; even first-page cursor declarations are validated.

Selection effect keys include nested sources, use an unambiguous encoding, and
are bounded opaque identities, not a serialized data contract. Invalid or live
selection declarations cannot consume unscoped table SSR seeds. Charts and
resource cards catch construction failures inside their cancellable fetch
effects. HTML, Shadcn, and MUI form prefill rejects invalid requests visibly.

`bindingRequestJson` returns `undefined` on rejection; that means **do not
dispatch**, never "substitute `{}`." `boundedDescriptorJson` builds a bounded
descriptor identity without getters/toJSON and omits explicitly unset protobuf
properties. It admits up to 512 structural levels to accommodate message/oneof
wrappers; existing 64-level semantic form and request limits remain unchanged.

These are work/copy limits, not a hard JavaScript heap or execution-time sandbox:
host allocations, proxy traps, and key enumeration are outside the budget.
Response rendering, form-control collection itself, and arbitrary host callbacks
are separate boundaries.

### Form and LRO submission contract

`buildSubmissionRequest` admits authored declarations separately, then charges
all referenced binding copies and automatic field assignments to one shared
request budget. It takes raw field-ID values, live selection, and an optional
ambient record. `formField` bindings can read only declared top-level field IDs;
unmodeled prefill properties cannot become a hidden binding context. Source
values are not mutated, reformatted, or copied into a second unbounded request.

For `FormPanel`, IDs are literal keys (including an ID such as `a.b`),
`request_field` is ignored for output mapping, and explicit bindings take
precedence over automatic field values. For LRO start, automatic inputs apply
after bindings using `request_field || field_id`, recursively including nested
field paths. Repeated values/maps retain raw JSON content. Missing automatic
values become null, matching the shared core.

Migration: older React/MUI forms let typed values win over a colliding binding;
the v1 path now follows the integrated shared-core rule above. Remove the
conflicting binding if a field should remain user-controlled. Submission errors
retain entered values for retry; an authored binding does not rewrite the editor.
HTML/Shadcn and MUI use the same builder, including no-input MUI LRO starts.
MUI contains synchronous/rejected failures, reports admission denial distinctly,
blocks pending duplicates, and ignores obsolete completions. A successful LRO
start is not operation completion or a production deployment authorization.

## Build & test

HTML and Shadcn media players degrade on playback errors to a safe poster, then
alt text. Caption, duration, chapter contents, and safe source links remain;
seek controls disable without a player. Unknown media kinds use recognized
source extensions or degrade. IMAGE ignores a separate poster. Error state
resets when the asset identity changes, and caption-track errors do not discard
an otherwise working player.

HTML and Shadcn LLM previews conceal masked slots, including nested and repeated
aggregates containing masked fields, until **Show masked values in preview** is
selected. Each new preview starts concealed. Multiline masked slots use native
password controls per line: Enter splits, boundary Backspace/Delete joins, and
paste preserves exact separators and trailing blank lines. Long values are
paged without truncating the value. The shared `MaskedMultiline` component also
supports controlled values and hidden form data. Masking protects against casual
visual disclosure, not host-page code or inspection of local form state.

```bash
bazel build //:web_react
bazel test //:test //:conformance   # conformance = the cross-shape crank seed
```
