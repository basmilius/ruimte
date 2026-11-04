#!/bin/sh
set -eu

cd "$CI_PRIMARY_REPOSITORY_PATH"
export HOMEBREW_NO_AUTO_UPDATE=1
if ! command -v xcodegen >/dev/null 2>&1; then
    brew install xcodegen
fi
# A build of a release tag carries that release's version, so the app and the desktop name one version.
# Apple takes only up to three numbers, so a beta builds as the version it leads to, told apart by its build number.
case "${CI_TAG:-}" in
    v[0-9]*)
        version="${CI_TAG#v}"
        sed -i '' "s/^\(    MARKETING_VERSION:\).*/\1 ${version%%-*}/" apps/ios/project.yml
        ;;
esac
# Set in the spec rather than with agvtool, which takes a test target's GENERATE_INFOPLIST_FILE = YES for a plist path.
if [ -n "${CI_BUILD_NUMBER:-}" ]; then
    sed -i '' "s/^\(    CURRENT_PROJECT_VERSION:\).*/\1 ${CI_BUILD_NUMBER}/" apps/ios/project.yml
fi
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
