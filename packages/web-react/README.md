# meridian-web-react

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

## Build & test

```bash
bazel build //:web_react
bazel test //:test //:conformance   # conformance = the cross-shape crank seed
```
