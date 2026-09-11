#!/usr/bin/env bash
set -euo pipefail

# The tests want to know what the machine holds, so every start rebuilds `/work` and throws away
# the daemon's own state. Set RUIMTE_KEEP_STATE=1 to keep a paired client across a restart.
if [ "${RUIMTE_KEEP_STATE:-0}" != "1" ]; then
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

if [ ! -d /work ]; then
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

    seed_repo /work/beacon
fi

exec bun /app/apps/server/src/main.ts \
    --host 0.0.0.0 \
    --port "${RUIMTE_PORT:-4310}" \
    --no-hooks \
    --no-price-fetch \
    "$@"
