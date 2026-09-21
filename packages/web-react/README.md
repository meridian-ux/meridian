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
