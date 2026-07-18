#!/usr/bin/env python3
"""Harvest every features/*.textproto (a fastverk.site.v1.Feature) into a single
FeatureCatalog JSON the Astro build consumes.

This is the feature-as-code seam: in the repo the textprotos live under features/;
in production each one is owned by its plugin-* repo (marketing/feature.textproto)
and this collector aggregates them. Under Bazel it runs as a py_binary over a
py_proto_library; standalone it uses a protoc-generated module on sys.path.

  python3 tools/collect_features.py                 # write src/content/features.json
  python3 tools/collect_features.py --check         # exit 1 if any feature is invalid

Requires: the generated feature_pb2 on sys.path (FEATURE_PB2_DIR env or tools/gen).
"""
import json
import os
import sys
import glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FEATURES = os.path.join(ROOT, "features")
OUT = os.path.join(ROOT, "src", "content", "features.json")

sys.path.insert(0, os.environ.get("FEATURE_PB2_DIR", os.path.join(HERE, "gen")))
try:
    from google.protobuf import text_format, json_format  # noqa: E402
    import feature_pb2  # noqa: E402
    _HAVE_PROTO = True
except Exception:  # protobuf / generated pb2 not on this interpreter
    _HAVE_PROTO = False


def _require(feat, path):
    problems = []
    if not feat.slug:
        problems.append(f"{path}: missing slug")
    if not feat.name:
        problems.append(f"{path}: missing name")
    if not feat.HasField("hero") or not feat.hero.headline:
        problems.append(f"{path}: missing hero.headline")
    if not feat.HasField("meta") or not feat.meta.title or not feat.meta.description:
        problems.append(f"{path}: missing meta.title/description")
    return problems


def main(argv):
    check = "--check" in argv[1:]
    if not _HAVE_PROTO:
        # No protobuf on this interpreter (e.g. a bare deploy host). The committed
        # features.json is the source of truth there; skip the check, refuse to regen.
        if check:
            print("features: protobuf unavailable — skipping validation (using committed features.json)")
            return 0
        print("collect_features: protobuf + generated feature_pb2 required to regenerate "
              "(run under the venv/Bazel with FEATURE_PB2_DIR set)", file=sys.stderr)
        return 2

    catalog = feature_pb2.FeatureCatalog()
    problems, slugs = [], set()

    # Sources, in precedence order: in-repo seeds (features/*.textproto), then any
    # migrated plugin repos (--from-plugins DIR globs DIR/plugin-*/marketing/
    # feature.textproto), which OVERRIDE a seed of the same slug (feature-as-code
    # ownership). Keyed by basename slug so a plugin repo wins.
    sources = {}  # slug -> path
    for path in sorted(glob.glob(os.path.join(FEATURES, "*.textproto"))):
        sources[os.path.splitext(os.path.basename(path))[0]] = path
    from_plugins = None
    for i, a in enumerate(argv[1:]):
        if a == "--from-plugins" and i + 1 < len(argv[1:]):
            from_plugins = argv[1:][i + 1]
    if from_plugins:
        for path in sorted(glob.glob(os.path.join(from_plugins, "plugin-*", "marketing", "feature.textproto"))):
            # slug = the plugin dir name minus the "plugin-" prefix.
            plugin = os.path.basename(os.path.dirname(os.path.dirname(path)))
            sources[plugin[len("plugin-"):] if plugin.startswith("plugin-") else plugin] = path

    for path in [sources[k] for k in sorted(sources)]:
        feat = feature_pb2.Feature()
        try:
            text_format.Parse(open(path, encoding="utf-8").read(), feat)
        except text_format.ParseError as e:
            problems.append(f"{os.path.basename(path)}: parse error: {e}")
            continue
        problems += _require(feat, os.path.basename(path))
        if feat.slug in slugs:
            problems.append(f"{os.path.basename(path)}: duplicate slug {feat.slug!r}")
        slugs.add(feat.slug)
        catalog.features.append(feat)

    if problems:
        print("feature-as-code check FAILED:", file=sys.stderr)
        for p in problems:
            print("  -", p, file=sys.stderr)
        return 1

    catalog.features.sort(key=lambda f: (f.order, f.slug))
    catalog.generated_from = f"{len(catalog.features)} features/*.textproto"

    if check:
        print(f"features: {len(catalog.features)} valid ✓")
        return 0

    data = json_format.MessageToDict(
        catalog, preserving_proto_field_name=True, use_integers_for_enums=False
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"features: wrote {OUT} ({len(catalog.features)} features)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
