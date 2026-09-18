#!/usr/bin/env bash
set -euo pipefail

# The suite runs against a container of its own on a port of its own, so it neither reads nor
# empties the state of the container that is kept around to work against (`compose.yml`).
here="$(cd "$(dirname "$0")" && pwd)"
compose=(docker compose -f "$here/compose.yml" --profile test)

# A statement key of this run's own, so the statements the suite signs never come near the address
# book's key: the container believes the public half, the suite signs with the private half.
eval "$(bun -e '
const { generateKeyPairSync } = require("node:crypto");
const pair = generateKeyPairSync("ed25519");
const pem = pair.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
console.log(`export RUIMTE_PULSAR_TEST_STATEMENT_KEY=${pair.publicKey.export({ format: "jwk" }).x}`);
console.log(`export RUIMTE_PULSAR_TEST_STATEMENT_PRIVATE_KEY=${Buffer.from(pem).toString("base64url")}`);
')"

# Recreated every run: the tests expect a daemon that has paired with nobody and a /work that
# holds the two seeded repositories and nothing else.
"${compose[@]}" up -d --build --force-recreate --wait daemon-test

status=0
(cd "$here/.." && RUIMTE_DOCKER=1 bun --config ../../integration.bunfig.toml test ./tests/remote-daemon.integration.test.ts "$@") || status=$?

"${compose[@]}" rm --stop --force --volumes daemon-test > /dev/null
exit "$status"
