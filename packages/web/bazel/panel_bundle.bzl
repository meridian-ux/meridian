"""`meridian_panel_bundle`: compiles a textproto `PanelBundle` to a
binary protobuf file consumable by every renderer.

The textproto is the source of truth for an app's UI surface; the
binpb is what the runtime watches + reloads. Authoring a single
textproto + parsing one binpb per renderer keeps all three renderers
reflection-free (no prost-reflect, no protobuf-js dynamic loader).

Usage:

```python
load("@meridian//bazel:panel_bundle.bzl", "meridian_panel_bundle")

meridian_panel_bundle(
    name = "panels",
    src = "panels.textproto",
    proto = "@meridian//proto:uiview_proto",
    message = "meridian.ui.v1.PanelBundle",
)
```

Output: `<name>.binpb` — a wire-encoded PanelBundle. Drop it into
your renderer's loadable assets; the dev runtime fsnotify-watches the
file for hot reload.
"""

load("@rules_proto//proto:defs.bzl", "ProtoInfo")

def _meridian_panel_bundle_impl(ctx):
    proto_info = ctx.attr.proto[ProtoInfo]
    out = ctx.actions.declare_file(ctx.label.name + ".binpb")

    # protoc --encode reads textproto from stdin and writes binpb to
    # stdout. Bazel actions don't natively redirect IO, so wrap the
    # invocation in a small shell command. transitive_sources +
    # transitive_proto_path give protoc everything it needs to
    # resolve imports (the meridian.ui.v1 schema imports
    # google/api/field_behavior.proto).
    proto_paths = proto_info.transitive_proto_path.to_list()

    # The trailing positional args to protoc are .proto files whose
    # combined symbol table must define `message`. v0.1 picked
    # direct_sources[0] which worked while the schema was a single
    # uiview.proto. After the v0.2.0 split, the top-level message
    # (PanelBundle) lives in panel.proto and isn't reachable from
    # rpc.proto (the first src). Pass ALL direct sources so the
    # symbol table is complete regardless of src ordering.
    direct_sources = proto_info.direct_sources
    if not direct_sources:
        fail("proto target {} has no direct sources".format(ctx.attr.proto.label))
    entries = " ".join([s.path for s in direct_sources])

    protoc = ctx.executable._protoc
    cmd = "{protoc} {paths} --encode={msg} {entries} < {src} > {out}".format(
        protoc = protoc.path,
        paths = " ".join(["--proto_path=" + p for p in proto_paths]),
        msg = ctx.attr.message,
        entries = entries,
        src = ctx.file.src.path,
        out = out.path,
    )

    ctx.actions.run_shell(
        outputs = [out],
        inputs = depset(direct = [ctx.file.src], transitive = [proto_info.transitive_sources]),
        tools = [protoc],
        command = cmd,
        mnemonic = "MeridianPanelBundle",
        progress_message = "Encoding panel bundle %s" % ctx.label,
    )

    return [DefaultInfo(files = depset([out]))]

meridian_panel_bundle = rule(
    implementation = _meridian_panel_bundle_impl,
    attrs = {
        "src": attr.label(
            allow_single_file = [".textproto"],
            mandatory = True,
            doc = "The textproto source. Authored by hand; the bundle's panels are listed under `panels { ... }` blocks.",
        ),
        "proto": attr.label(
            providers = [ProtoInfo],
            mandatory = True,
            doc = "proto_library target that defines `message`. Its transitive imports become protoc's `--proto_path`.",
        ),
        "message": attr.string(
            default = "meridian.ui.v1.PanelBundle",
            doc = "Fully-qualified message name protoc should `--encode`. Defaults to the canonical Meridian bundle type.",
        ),
        "_protoc": attr.label(
            default = "@protobuf//:protoc",
            executable = True,
            cfg = "exec",
        ),
    },
)
