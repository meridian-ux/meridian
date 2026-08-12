#!/usr/bin/env bash
# Make `bazel build //...` runnable in an environment that cannot fetch GitHub
# source archives.
#
#     tools/bazel_local_overrides.sh
#     bazel build //... $(cat /tmp/bzl/flags)
#
# WHY THIS EXISTS. In a Claude Code session (and on any host behind a proxy that
# scopes GitHub by repository) `https://github.com/<org>/<repo>/archive/…` — the
# URL http_archive uses, which redirects to codeload — returns 403 for repos the
# session is not scoped to. Module *resolution* works: both registries serve 200,
# and `bazel mod deps` completes. Only the tarball fetch fails, so every Bazel
# error had to be read out of a ~10-minute CI log, one cause per round trip.
#
# git is NOT scoped. `git ls-remote` succeeds on every repo below, so cloning at
# the pinned tag and pointing --override_module at the clone sidesteps the whole
# problem: --override_module takes a PATH and performs no integrity check.
#
# WHY ONLY SIX. Of the 52 modules in the resolved graph, 40 come from GitHub
# *release assets* (which redirect to release-assets.githubusercontent.com and are
# not scoped) or from non-GitHub hosts, and fetch normally. Twelve use the archive
# path; six of those are in this repo's fetch closure. The other six —
# rules_aip, rules_github, meridian_schemas (all three artifacts of a stale
# lockfile) and jsoncpp, rules_android, swift_argument_parser (nothing reaches
# them) — are never fetched.
#
# DEVELOPER TOOLING. CI is not scoped and fetches everything normally; nothing
# here is wired into a workflow. If a pin below drifts from MODULE.bazel the
# override silently builds the wrong thing, so the versions are asserted against
# MODULE.bazel at the end.
set -euo pipefail

DEST="${BZL_OVERRIDE_DIR:-/tmp/bzl}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$DEST"

# DIRECT deps: name → org/repo@tag, asserted against MODULE.bazel below.
TAGGED=(
  "brando=mattmarshall/brando@v0.5.0"
  "rules_astro=tomato-bazel/rules_astro@v0.0.1"
  "rules_chrome=tomato-bazel/rules_chrome@v0.1.0"
  "rules_tectonic=tomato-bazel/rules_tectonic@v0.2.0"
  "rules_vite=tomato-bazel/rules_vite@v0.1.0"
)

# TRANSITIVE deps that also use the archive path, so they need overrides too but
# appear in no bazel_dep here and cannot be pin-checked against MODULE.bazel.
#
# rules_github is reached through brando and it is NOT optional: without it every
# one of the 104 top-level targets fails analysis with a single 403, because the
# failure lands in a repo the toolchain graph passes through rather than in
# anything this repo names. I predicted it was unreachable and the first local
# run disproved that in 72 seconds — which is the harness earning its keep.
#
# rules_aip is on the same host with the same shape; an override for a module
# outside the graph is inert, so it costs a shallow clone and removes a round trip.
TRANSITIVE=(
  "rules_github=tomato-bazel/rules_github@v0.1.1"
  "rules_aip=tomato-bazel/rules_aip@v0.3.0"
)

# googleapis is pinned to a commit, not a tag, and its BCR entry is not a plain
# archive: it carries a six-file overlay plus module_dot_bazel.patch.
# --override_module applies NEITHER, so a bare clone would give us a different
# @googleapis than CI uses — worse than not building locally at all. The overlay
# is what supplies MODULE.bazel and extensions.bzl; googleapis itself ships no
# MODULE.bazel.
GOOGLEAPIS_VERSION="0.0.0-20260422-20ac242a"
GOOGLEAPIS_SHA="20ac242a6b3a723cb10c1a0201209261addaf7d8"
BCR="https://bcr.bazel.build/modules/googleapis/${GOOGLEAPIS_VERSION}"
GOOGLEAPIS_OVERLAY=(
  MODULE.bazel
  extensions.bzl
  tests/bcr/.bazelrc
  tests/bcr/BUILD.bazel
  tests/bcr/MODULE.bazel
  tests/bcr/failure_test.bzl
)

log() { printf '\033[1m==>\033[0m %s\n' "$*"; }

clone_tag() {
  local name="$1" spec="$2" repo tag dir
  repo="${spec%@*}"; tag="${spec##*@}"; dir="$DEST/$name"
  if [ -d "$dir/.git" ] && [ "$(git -C "$dir" describe --tags --exact-match 2>/dev/null || true)" = "$tag" ]; then
    log "$name @ $tag — already present"
    return
  fi
  log "$name @ $tag  <-  $repo"
  rm -rf "$dir"
  git clone -q --depth 1 --branch "$tag" "https://github.com/$repo" "$dir"
}

clone_googleapis() {
  local dir="$DEST/googleapis"
  if [ -f "$dir/.overlay-stamp" ] && [ "$(cat "$dir/.overlay-stamp")" = "$GOOGLEAPIS_SHA" ]; then
    log "googleapis @ ${GOOGLEAPIS_SHA:0:8} — already present"
    return
  fi
  log "googleapis @ ${GOOGLEAPIS_SHA:0:8}  <-  googleapis/googleapis"
  rm -rf "$dir"
  # Fetch the one commit rather than cloning the history; googleapis is large and
  # BCR pins a bare SHA, so there is no tag to shallow-clone.
  git init -q "$dir"
  git -C "$dir" remote add origin https://github.com/googleapis/googleapis
  git -C "$dir" fetch -q --depth 1 origin "$GOOGLEAPIS_SHA"
  git -C "$dir" checkout -q FETCH_HEAD

  log "  overlay (${#GOOGLEAPIS_OVERLAY[@]} files) + module_dot_bazel.patch from BCR"
  for f in "${GOOGLEAPIS_OVERLAY[@]}"; do
    mkdir -p "$dir/$(dirname "$f")"
    curl -fsSL "$BCR/overlay/$f" -o "$dir/$f"
  done
  # module_dot_bazel.patch is the LEGACY half of the same change: it creates
  # MODULE.bazel from nothing (googleapis ships none), which is exactly what
  # overlay/MODULE.bazel now does. BCR serves both for older Bazel versions, so
  # on a tree that already has the overlay the patch cannot apply — the file is
  # not absent any more. Apply it only if it applies, and otherwise assert the
  # overlay produced the same content rather than skipping silently.
  curl -fsSL "$BCR/patches/module_dot_bazel.patch" -o "$dir/.bcr.patch"
  if ( cd "$dir" && git apply -p0 --check .bcr.patch >/dev/null 2>&1 ); then
    ( cd "$dir" && git apply -p0 .bcr.patch )
    log "  applied module_dot_bazel.patch"
  else
    # The patch body is the file, one '+' per line. Compare it to what we have.
    sed -n 's/^+//p' "$dir/.bcr.patch" | tail -n +1 > "$dir/.bcr.expected"
    if diff -q <(sed -e '/^--- /d' -e '/^+++ /d' -e '/^@@ /d' -e 's/^+//' "$dir/.bcr.patch") \
               "$dir/MODULE.bazel" >/dev/null; then
      log "  module_dot_bazel.patch already satisfied by overlay/MODULE.bazel"
    else
      echo "  ! module_dot_bazel.patch neither applies nor matches the overlay" >&2
      echo "    the local @googleapis would differ from CI's — refusing" >&2
      exit 1
    fi
    rm -f "$dir/.bcr.expected"
  fi
  rm -f "$dir/.bcr.patch"
  echo "$GOOGLEAPIS_SHA" > "$dir/.overlay-stamp"
}

assert_pin() {
  local name="$1" want="$2" got
  got="$(sed -n "s/^bazel_dep(name = \"$name\", version = \"\([^\"]*\)\".*/\1/p" "$REPO_ROOT/MODULE.bazel")"
  if [ -z "$got" ]; then
    echo "  ! $name is not a bazel_dep any more — drop it from this script" >&2
    return 1
  fi
  if [ "$got" != "$want" ]; then
    echo "  ! $name: MODULE.bazel says $got, this script clones $want" >&2
    return 1
  fi
}

for entry in "${TAGGED[@]}" "${TRANSITIVE[@]}"; do
  clone_tag "${entry%%=*}" "${entry#*=}"
done
clone_googleapis

log "checking the pins against MODULE.bazel"
rc=0
for entry in "${TAGGED[@]}"; do
  name="${entry%%=*}"; tag="${entry##*@}"
  assert_pin "$name" "${tag#v}" || rc=1
done
assert_pin googleapis "$GOOGLEAPIS_VERSION" || rc=1
[ "$rc" -eq 0 ] || { echo "pins are stale — fix them before trusting a local build" >&2; exit 1; }
log "pins OK"

{
  for entry in "${TAGGED[@]}" "${TRANSITIVE[@]}"; do
    name="${entry%%=*}"
    printf -- "--override_module=%s=%s/%s " "$name" "$DEST" "$name"
  done
  printf -- "--override_module=googleapis=%s/googleapis" "$DEST"
} > "$DEST/flags"

# bats is NOT a module, so --override_module cannot reach it. aspect_bazel_lib
# does register_toolchains("@bats_toolchains//:all"), which forces an http_archive
# fetch of bats-core just to ENUMERATE the package — and that archive 403s like
# any other. Nothing in this repo uses a bats toolchain, so an empty package makes
# the wildcard resolve to nothing. Two canonical names because both bazel_lib and
# aspect_bazel_lib are in the graph.
STUB="$DEST/bats_stub"
mkdir -p "$STUB"
: > "$STUB/REPO.bazel"
cat > "$STUB/BUILD.bazel" <<'STUBEOF'
# Local harness stub — see tools/bazel_local_overrides.sh. Deliberately empty:
# register_toolchains("@bats_toolchains//:all") over a package with no toolchains
# is a no-op, which is what we want, because nothing here uses bats.
STUBEOF
for canonical in aspect_bazel_lib++toolchains+bats_toolchains bazel_lib++toolchains+bats_toolchains; do
  printf -- " --override_repository=%s=%s" "$canonical" "$STUB" >> "$DEST/flags"
done

# An overridden repo is a SYMLINK to a path outside the workspace, and
# linux-sandbox does not mount that path — so actions reading a source file from
# one of these repos fail with "No such file or directory" for a file that is
# plainly there. It surfaces as a protoc or cp error inside the external repo
# (`Could not make proto path relative: external/googleapis+/google/api/
# field_behavior.proto`), which reads like a broken clone rather than a missing
# mount. Analysis never touches source files, so --nobuild is clean either way;
# only the action phase notices.
printf -- " --sandbox_add_mount_pair=%s" "$DEST" >> "$DEST/flags"

# MATCH CI'S SANDBOX. GitHub runners have no user namespaces, so Bazel falls back
# to processwrapper-sandbox there — 320 actions on it and ZERO on linux-sandbox in
# the last CI run. Locally linux-sandbox IS available, and it mounts $HOME
# read-only, so tectonic_pdf (use_default_shell_env = True, "Tectonic touches HOME
# for its bundle cache") dies with `Read-only file system (os error 30)` on a
# target CI builds fine. The harness is stricter than CI in this one dimension;
# this makes the two agree.
printf -- " --strategy=TectonicPdf=processwrapper-sandbox" >> "$DEST/flags"

log "wrote $DEST/flags"
echo
echo "  bazel build --nobuild //... \$(cat $DEST/flags)   # analysis"
echo "  bazel build //...          \$(cat $DEST/flags)   # actions"
echo "  bazel test  //...          \$(cat $DEST/flags)"
echo
echo "Analysis alone is not enough: the codegen, packaging and rustc failures"
echo "this repo find here are all action-level — run the full build, not --nobuild."
echo
echo "KNOWN LOCAL GAP: the three //packages/mui-kit tectonic_pdf targets."
echo "Tectonic fetches its TeX bundle at build time, and its HTTP client is"
echo "refused by this environment's agent proxy (403 for"
echo "relay.fullyjustified.net/default_bundle_v33.tar) while curl to the same URL"
echo "streams fine — a per-tool proxy issue, not a repo one. Their INPUTS are"
echo "verifiable and are what the merge actually broke, so build"
echo "//packages/mui-kit:{catalog,proto,studio}_figures to check that chain and"
echo "leave the PDFs to CI."
