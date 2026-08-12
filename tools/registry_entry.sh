#!/usr/bin/env bash
# Emit the registry.tbzl.dev entry for this module at the current version.
#
#   tools/registry_entry.sh [outdir]     # default: ./.registry-entry
#
# Then copy the tree into a checkout of tomato-bazel/bazel-registry and open a PR.
#
# WHY THIS IS A SCRIPT AND NOT THREE CHECKED-IN FILES. `source.json` carries an
# `integrity` hash of the RELEASE TARBALL, which does not exist until the tag is
# pushed and GitHub has generated it. So the entry cannot be written ahead of the
# release — it is computed from it. Hand-computing a base64 SHA-256 is also
# exactly the kind of step that goes wrong silently: a wrong hash does not fail
# at publish, it fails for whoever fetches the module next, with an error about
# checksum mismatch that reads like a supply-chain attack.
#
# WHY THE ENTRY MATTERS MORE THAN IT LOOKS. Nothing in this estate can build from
# BCR alone: brando, rules_chrome, rules_tectonic, rules_astro and rules_vite have
# no BCR entry. And meridian-internal's `bazel_dep(name = "meridian", ...)` is
# committed COMMENTED OUT, waiting on precisely this — so until the entry lands,
# that repository cannot resolve its module graph at all.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$HERE/.registry-entry}"

MODULE="$(python3 - "$HERE/MODULE.bazel" <<'PY'
import re, sys, pathlib
t = pathlib.Path(sys.argv[1]).read_text()
# ANCHORED to line start. An unanchored `module\(` matches the docstring's own
# prose about `module(version)` and yields the string "version" — which it did,
# on the first run of this script.
m = re.search(r'^module\((.*?)^\)', t, re.S | re.M).group(1)
print(re.search(r'name\s*=\s*"([^"]+)"', m).group(1))
print(re.search(r'version\s*=\s*"([^"]+)"', m).group(1))
PY
)"
NAME="$(echo "$MODULE" | sed -n 1p)"
VERSION="$(echo "$MODULE" | sed -n 2p)"
REPO="meridian-ux/meridian"
URL="https://github.com/$REPO/archive/refs/tags/v$VERSION.tar.gz"

echo "module:  $NAME@$VERSION"
echo "tarball: $URL"

# The tag has to exist. Fail loudly rather than emitting an entry with a hash of a
# 404 page, which is a thing that happens and is very confusing downstream.
if ! curl -fsSLI "$URL" >/dev/null 2>&1; then
  echo >&2
  echo "ERROR: $URL does not exist yet." >&2
  echo "Push the v$VERSION tag first — the integrity hash is computed FROM the" >&2
  echo "release tarball, so the registry entry is made after the release, not before." >&2
  exit 1
fi

INTEGRITY="sha256-$(curl -fsSL "$URL" | sha256sum | cut -d' ' -f1 | xxd -r -p | base64)"
echo "integrity: $INTEGRITY"

DEST="$OUT/modules/$NAME/$VERSION"
mkdir -p "$DEST"

# The registry's copy of MODULE.bazel is what Bazel reads to do version
# resolution WITHOUT fetching the source. It must match the tag's file exactly,
# so it is copied rather than regenerated.
cp "$HERE/MODULE.bazel" "$DEST/MODULE.bazel"

cat > "$DEST/source.json" <<JSON
{
  "integrity": "$INTEGRITY",
  "strip_prefix": "meridian-$VERSION",
  "url": "$URL"
}
JSON

# metadata.json lives one level up and accumulates versions. Merged rather than
# overwritten, because clobbering it would un-publish every earlier release.
META="$OUT/modules/$NAME/metadata.json"
export EXISTING_META="$(curl -fsSL "https://registry.tbzl.dev/modules/$NAME/metadata.json" 2>/dev/null || echo '')"
python3 - "$META" "$VERSION" "$REPO" <<PY
import json, os, sys
meta_path, version, repo = sys.argv[1], sys.argv[2], sys.argv[3]
existing = os.environ.get("EXISTING_META", "").strip()
meta = json.loads(existing) if existing else {
    "homepage": f"https://github.com/{repo}",
    "maintainers": [{"name": "Matt Marshall", "github": "mattmarshall"}],
    "repository": [f"github:{repo}"],
    "versions": [],
    "yanked_versions": {},
}
if version not in meta["versions"]:
    meta["versions"].append(version)
meta["versions"].sort(key=lambda v: [int(p) for p in v.split(".")])
open(meta_path, "w").write(json.dumps(meta, indent=2) + "\n")
PY

echo
echo "wrote:"
find "$OUT" -type f | sed "s|$OUT/|  |"
echo
echo "Next:"
echo "  1. clone tomato-bazel/bazel-registry"
echo "  2. cp -r $OUT/modules/* <registry>/modules/"
echo "  3. open a PR; once merged, meridian-internal's bazel_dep can be uncommented"
