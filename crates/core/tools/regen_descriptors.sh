#!/usr/bin/env bash
# Regenerate rust/uiview/proto/gen/meridian_ui_v1.binpb — the cargo build's input.
#
# Bazel generates from //schemas/proto:uiview_proto; Cargo consumes a committed
# image so native builds do not require Bazel. Keep these two source graphs in
# agreement rather than assembling the image from a second hand-maintained list.
#
# Usage:
#   crates/core/tools/regen_descriptors.sh [path-to-standalone-schemas]
#
# Default: Bazel, Node, and installed schema workspace dependencies.
# Legacy standalone override: protoc and googleapis' field_behavior.proto.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
SCHEMAS="${1:-$REPO_ROOT/schemas}"
OUT="$HERE/rust/uiview/proto/gen/meridian_ui_v1.binpb"

# The monorepo default uses Bazel's actual source graph and dependency versions,
# including its well-known types. No host protoc version or second file catalog.
if [ "$#" -eq 0 ]; then
  cd "$REPO_ROOT"
  bazel build --announce_rc=false //schemas/proto:uiview_proto
  DESCRIPTORS="$(bazel cquery --announce_rc=false 'deps(//schemas/proto:uiview_proto)' --output=files)"
  INPUTS=()
  while IFS= read -r entry; do
    case "$entry" in
      *-descriptor-set.proto.bin) INPUTS+=("$REPO_ROOT/$entry") ;;
    esac
  done <<< "$DESCRIPTORS"
  [ "${#INPUTS[@]}" -gt 0 ] || { echo "Bazel returned no descriptor outputs" >&2; exit 1; }
  cd "$REPO_ROOT/schemas"
  node tools/merge_descriptor_sets.mjs --output "$OUT" "${INPUTS[@]}"
  exit 0
fi

[ -d "$SCHEMAS/proto" ] || { echo "no proto/ under $SCHEMAS — pass the meridian-schemas checkout as \$1" >&2; exit 1; }

# The file list is derived from proto/BUILD.bazel's `uiview_proto` proto_library,
# NOT hand-maintained here — a second list would drift against the first, which is
# the exact failure mode meridian-uiview-core's BUILD.bazel comment warns about.
SRCS="$(python3 - "$SCHEMAS" <<'PY'
import re, sys, pathlib
build = pathlib.Path(sys.argv[1], "proto", "BUILD.bazel").read_text()
blk = re.search(r'proto_library\(\s*name = "uiview_proto".*?\)\n', build, re.S).group(0)
srcs = re.search(r'\bsrcs\s*=\s*\[(.*?)\]', blk, re.S).group(1)
print(" ".join("proto/" + p for p in re.findall(r'"([^"]+\.proto)"', srcs)))
PY
)"

# Reuse the repository's vendored googleapis source when present. The fallback
# keeps the script usable with a standalone meridian-schemas checkout.
GAPI="$REPO_ROOT/third_party/googleapis"
if [ ! -f "$GAPI/google/api/field_behavior.proto" ]; then
  GAPI="$(mktemp -d)"
  mkdir -p "$GAPI/google/api"
  trap 'rm -rf "$GAPI"' EXIT
  curl -fsSL -o "$GAPI/google/api/field_behavior.proto" \
    "https://raw.githubusercontent.com/googleapis/googleapis/master/google/api/field_behavior.proto"
fi

mkdir -p "$(dirname "$OUT")"
( cd "$SCHEMAS" && protoc --include_imports --descriptor_set_out="$OUT" -I . -I "$GAPI" $SRCS )

echo "wrote $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes) from $(echo "$SRCS" | wc -w) protos"
echo "Now run: (cd rust && cargo test -p meridian-uiview)"
