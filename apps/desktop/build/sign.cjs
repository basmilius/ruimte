// electron-builder signs every nested file with `entitlementsInherit`, which opens up JIT and library
// validation for Electron and the daemon. The computer use helper holds Accessibility and Screen
// Recording, so it keeps the empty entitlements it is built with and nothing is loaded into it.
const { createRequire } = require('node:module');
const { existsSync } = require('node:fs');
const { join, sep } = require('node:path');

const builderLib = createRequire(require.resolve('electron-builder/package.json')).resolve('app-builder-lib/package.json');
const { signAsync } = createRequire(builderLib)('@electron/osx-sign');

const helper = `${sep}Contents${sep}Helpers${sep}Ruimte Computer Use.app`;
const helperEntitlements = join(__dirname, '..', '..', 'computer-use', 'Resources', 'entitlements.plist');

module.exports = async (options) => {
    const optionsForFile = options.optionsForFile ?? (() => ({}));
    const foundationHelper = join(options.app, 'Contents', 'Resources', 'bin', 'native', 'ruimte-foundation-models');
    await signAsync({
        ...options,
        binaries: [...(options.binaries ?? []), ...(existsSync(foundationHelper) ? [foundationHelper] : [])],
        optionsForFile: (file) => (file.includes(helper) ? { ...optionsForFile(file), entitlements: helperEntitlements } : optionsForFile(file))
    });
};
