#!/usr/bin/env bash
set -euo pipefail

# The container is a machine to work against, so it keeps what is put on it. Only the test
# container asks for a daemon that has seen nothing, with RUIMTE_FRESH_STATE=1 (`compose.yml`).
if [ "${RUIMTE_FRESH_STATE:-0}" = "1" ]; then
    rm -rf /work "${RUIMTE_HOME:-/root/.ruimte}"
fi

seed_repo() {
    local path="$1"
    mkdir -p "$path"
    git -C "$path" init --quiet
    printf '# %s\n\nA repository that only exists to be looked at.\n' "$(basename "$path")" > "$path/README.md"
    git -C "$path" add README.md
    git -C "$path" commit --quiet -m 'chore: start the repository'
}

# Per repository, not per /work: the volume keeps whatever is put there by hand, and a seed that
# ran once must not write over it on the next start.
if [ ! -e /work/atlas ]; then
    seed_repo /work/atlas
    mkdir -p /work/atlas/src
    printf 'export const beam = () => 42;\n' > /work/atlas/src/beam.ts
    git -C /work/atlas add src/beam.ts
    git -C /work/atlas commit --quiet -m 'feat: a beam to look at'
    printf 'export const lens = () => 7;\n' > /work/atlas/src/lens.ts
    git -C /work/atlas add src/lens.ts
    git -C /work/atlas commit --quiet -m 'feat: a lens next to the beam'

    git -C /work/atlas branch lighthouse

    # What `git.status` is tested against: one tracked file changed, one file git has never seen.
    printf '\nA line nobody committed.\n' >> /work/atlas/README.md
    printf 'Loose thoughts.\n' > /work/atlas/notes.txt
fi

if [ ! -e /work/beacon ]; then
    seed_repo /work/beacon
fi

exec bun /app/apps/server/src/main.ts \
    --host 0.0.0.0 \
    --port "${RUIMTE_PORT:-4310}" \
    --no-hooks \
    --no-price-fetch \
    "$@"
