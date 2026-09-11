#!/usr/bin/env bash
set -euo pipefail

container="${RUIMTE_DOCKER_CONTAINER:-ruimte-remote}"
port="${RUIMTE_DOCKER_PORT:-4310}"

# A pairing token goes only to a client on the daemon's own machine, so the request is made from
# inside the container. The URL that comes back names the container, which nothing here resolves,
# so only the token after the fragment is worth keeping.
token=$(docker exec "$container" bun /app/apps/server/src/main.ts pair --port 4310 | tail -n 1 | sed 's/.*#//')
if [ -z "$token" ]; then
    echo "No pairing token came back; is the container running?" >&2
    exit 1
fi

echo "Paste this into Ruimte on this machine within ten minutes:"
echo "http://127.0.0.1:${port}/pair#${token}"
