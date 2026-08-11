#!/usr/bin/env python3
"""Validate a repo's marketing/feature.textproto (the RepoReadiness criterion).

A plugin repo is "feature-as-code ready" when it carries a valid
`marketing/feature.textproto` (a fastverk.site.v1.Feature) with the fields the site
needs to render its /features/<slug> page. Run in the plugin repo's CI:

  python3 validate_feature.py                       # checks ./marketing/feature.textproto
  python3 validate_feature.py path/to/feature.textproto

Exit 0 = valid; 1 = present but invalid; 2 = missing / no protobuf toolchain.
Requires the generated feature_pb2 on sys.path (FEATURE_PB2_DIR, default ./gen).
"""
import os
import sys

sys.path.insert(0, os.environ.get("FEATURE_PB2_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "gen")))
try:
    from google.protobuf import text_format
    import feature_pb2
except Exception:
    print("validate_feature: protobuf + generated feature_pb2 required "
          "(set FEATURE_PB2_DIR)", file=sys.stderr)
    sys.exit(2)


def main(argv):
    path = argv[1] if len(argv) > 1 else os.path.join("marketing", "feature.textproto")
    if not os.path.exists(path):
        print(f"NOT READY: {path} is missing (add the plugin's marketing/feature.textproto)", file=sys.stderr)
        return 2

    feat = feature_pb2.Feature()
    try:
        text_format.Parse(open(path, encoding="utf-8").read(), feat)
    except text_format.ParseError as e:
        print(f"INVALID: {path}: parse error: {e}", file=sys.stderr)
        return 1

    problems = []
    if not feat.slug:
        problems.append("missing slug")
    if not feat.name:
        problems.append("missing name")
    if not feat.HasField("hero") or not feat.hero.headline:
        problems.append("missing hero.headline")
    if not feat.HasField("meta") or not feat.meta.title or not feat.meta.description:
        problems.append("missing meta.title/description")
    if problems:
        print(f"INVALID: {path}: " + "; ".join(problems), file=sys.stderr)
        return 1

    print(f"READY: {path} — {feat.slug} ({feat.name}) ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
