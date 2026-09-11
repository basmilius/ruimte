#!/usr/bin/env bash
set -euo pipefail

# The suite runs against a container of its own on a port of its own, so it neither reads nor
# empties the state of the container that is kept around to work against (`compose.yml`).
here="$(cd "$(dirname "$0")" && pwd)"
compose=(docker compose -f "$here/compose.yml" --profile test)

# Recreated every run: the tests expect a daemon that has paired with nobody and a /work that
# holds the two seeded repositories and nothing else.
"${compose[@]}" up -d --build --force-recreate --wait daemon-test

status=0
RUIMTE_DOCKER=1 bun test "$here/../src/docker" "$@" || status=$?

"${compose[@]}" rm --stop --force --volumes daemon-test > /dev/null
exit "$status"
