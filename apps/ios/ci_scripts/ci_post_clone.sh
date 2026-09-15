#!/bin/sh
set -eu

cd "$CI_PRIMARY_REPOSITORY_PATH"
export HOMEBREW_NO_AUTO_UPDATE=1
if ! command -v xcodegen >/dev/null 2>&1; then
    brew install xcodegen
fi
xcodegen generate --spec apps/ios/project.yml
xcodebuild -downloadComponent MetalToolchain
