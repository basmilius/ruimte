#!/usr/bin/env bash
set -euo pipefail
# The app owns download consent, progress, cancellation and integrity verification.
printf '%s\n' 'Enable Speech to Text in Settings > Voice to download the streaming model.'
printf '%s\n' 'The model is not downloaded by build scripts or bundled with the app.'
