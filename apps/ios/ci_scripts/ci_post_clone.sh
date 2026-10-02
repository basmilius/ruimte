#!/bin/sh
set -eu

cd "$CI_PRIMARY_REPOSITORY_PATH"
export HOMEBREW_NO_AUTO_UPDATE=1
if ! command -v xcodegen >/dev/null 2>&1; then
    brew install xcodegen
fi
# A build of a release tag carries that release's version, so the app and the desktop name one version.
case "${CI_TAG:-}" in
    v[0-9]*)
        sed -i '' "s/^\(    MARKETING_VERSION:\).*/\1 ${CI_TAG#v}/" apps/ios/project.yml
        ;;
esac
xcodegen generate --spec apps/ios/project.yml
# The Xcode Cloud image may carry the toolchain already, and xcodebuild then answers with an error.
if ! output=$(xcodebuild -downloadComponent MetalToolchain 2>&1); then
    case "$output" in
        *"already imported"*) ;;
        *)
            echo "$output" >&2
            exit 1
            ;;
    esac
fi
echo "$output"
