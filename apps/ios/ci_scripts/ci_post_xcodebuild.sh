#!/bin/sh
set -u

# Uploads the archive's dSYMs so crash reports read as symbols. Only for an archive and only with the
# OBSERVATORY_UPLOAD_TOKEN secret of the workflow; a failure here never fails the build.
if [ "${CI_XCODEBUILD_ACTION:-}" != "archive" ] || [ -z "${OBSERVATORY_UPLOAD_TOKEN:-}" ]; then
    exit 0
fi
dsyms="${CI_ARCHIVE_PATH:-}/dSYMs"
if [ ! -d "$dsyms" ]; then
    echo "No dSYMs in the archive, so none were uploaded."
    exit 0
fi
# The ingest takes one debug file per request, so each Mach-O inside a dSYM goes up on its own.
find "$dsyms" -path '*.dSYM/Contents/Resources/DWARF/*' -type f | while IFS= read -r file; do
    gzip -c "$file" | curl --fail --silent --show-error --max-time 300 \
        -H "Authorization: Bearer $OBSERVATORY_UPLOAD_TOKEN" \
        -H 'Content-Type: application/octet-stream' -H 'Content-Encoding: gzip' \
        --data-binary @- https://ingest.bmnw.nl/api/symbols/native >/dev/null ||
        echo "The upload of $(basename "$file") failed; the build goes on without it."
done
exit 0
