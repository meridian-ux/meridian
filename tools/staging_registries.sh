#!/usr/bin/env bash
set -euo pipefail

mode=${1:?expected stage or failure-probe}
evidence="$RUNNER_TEMP/staging-evidence"
work=$(mktemp -d "$RUNNER_TEMP/meridian-staging.XXXXXXXX")
npm_container="${work##*/}-npm"
cargo_container="${work##*/}-cargo"
verdaccio='docker.io/verdaccio/verdaccio:6.1.6@sha256:44af8dec4b8bfb9b940263f56ee5f371484515e4397eea56ab9c942500ab9dfa'
kellnr='ghcr.io/kellnr/kellnr:5.14.0@sha256:f4306f69be76899a42dfe87d638818b352d0b4274098c836073edca8ef4961f9'

cleanup() {
    status=$?
    trap - EXIT
    set +e
    docker rm -fv "$npm_container" "$cargo_container" >/dev/null 2>&1
    rm -rf -- "$work"
    remaining=$(docker ps -aq --filter "name=${work##*/}")
    if [[ $? != 0 || -n "$remaining" || -e "$work" ]] ||
        curl -sS --max-time 2 -o /dev/null http://127.0.0.1:4873/ 2>/dev/null ||
        curl -sS --max-time 2 -o /dev/null http://127.0.0.1:8000/ 2>/dev/null; then
        echo "Cleanup verification failed ($mode)" | tee -a "$evidence/cleanup.txt"
        exit 1
    fi
    echo "Cleanup verified ($mode, original exit $status): containers, listener ports and temporary files removed." |
        tee -a "$evidence/cleanup.txt"
    exit "$status"
}

stage() (
    trap cleanup EXIT
    trap 'exit 143' TERM
    trap 'exit 130' INT

    cat > "$work/verdaccio.yaml" <<'YAML'
storage: /verdaccio/storage
auth:
  htpasswd:
    file: /verdaccio/storage/htpasswd
    max_users: 1
uplinks: {}
packages:
  '@meridian-ux/*':
    access: $all
    publish: staging
log: { type: stdout, format: pretty, level: warn }
web: { enable: false }
YAML
    export STAGING_CARGO_TOKEN=$(openssl rand -hex 32)
    export KELLNR_SETUP__ADMIN_TOKEN="$STAGING_CARGO_TOKEN"
    export KELLNR_SETUP__ADMIN_PWD=$(openssl rand -hex 32)
    echo "::add-mask::$STAGING_CARGO_TOKEN"
    echo "::add-mask::$KELLNR_SETUP__ADMIN_PWD"
    docker run -d --name "$npm_container" -p 127.0.0.1:4873:4873 \
        --mount "type=bind,src=$work/verdaccio.yaml,dst=/verdaccio/conf/config.yaml,readonly" \
        --tmpfs /verdaccio/storage:uid=10001,gid=65533 "$verdaccio"
    docker run -d --name "$cargo_container" -p 127.0.0.1:8000:8000 \
        --tmpfs /staging:mode=1777 \
        -e KELLNR_SETUP__ADMIN_TOKEN -e KELLNR_SETUP__ADMIN_PWD \
        -e KELLNR_REGISTRY__DATA_DIR=/staging -e KELLNR_ORIGIN__HOSTNAME=127.0.0.1 \
        -e KELLNR_DOCS__ENABLED=false "$kellnr"
    unset KELLNR_SETUP__ADMIN_TOKEN KELLNR_SETUP__ADMIN_PWD
    for url in http://127.0.0.1:4873/-/ping http://127.0.0.1:8000/api/v1/crates/config.json; do
        curl --fail --silent --show-error --retry 30 --retry-all-errors --retry-delay 1 --max-time 5 "$url" >/dev/null
    done
    printf '%s\n' "$verdaccio" "$kellnr" > "$evidence/images.txt"
    if [[ "$mode" == failure-probe ]]; then
        touch "$work/forced-failure"
        exit 42
    fi
    python3 tools/staging_registries.py "$work" "$evidence" 2>&1 | tee "$evidence/staging.log"
)

case "$mode" in
    failure-probe)
        set +e
        # The subprocess explicitly enables errexit because we need to inspect its status.
        (set -e; stage)
        status=$?
        [[ "$status" == 42 ]]
        ;;
    stage) stage ;;
    *) exit 2 ;;
esac
