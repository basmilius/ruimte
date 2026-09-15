#!/bin/sh
set -eu

cd "$CI_PRIMARY_REPOSITORY_PATH/apps/ios"
if [ -n "${CI_BUILD_NUMBER:-}" ]; then
    xcrun agvtool new-version -all "$CI_BUILD_NUMBER"
fi
