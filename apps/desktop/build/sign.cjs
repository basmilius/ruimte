// electron-builder signs every nested file with `entitlementsInherit`, which opens up JIT for Electron.
// The daemon also turns off library validation, for the native addons of what it runs as Bun. The
// computer use helper holds Accessibility and Screen Recording, so it keeps the empty entitlements it
// is built with and nothing is loaded into it.
const { createRequire } = require('node:module');
const { existsSync } = require('node:fs');
const { join, sep } = require('node:path');

const helper = `${sep}Contents${sep}Helpers${sep}Ruimte Computer Use.app`;
const helperEntitlements = join(__dirname, '..', '..', 'computer-use', 'Resources', 'entitlements.plist');
const daemon = `${sep}Contents${sep}Resources${sep}bin${sep}ruimte`;
const daemonEntitlements = join(__dirname, 'entitlements.daemon.plist');

/* The entitlements a file gets in place of `entitlementsInherit`, or null to keep those. */
function entitlementsFor(file) {
    if (file.includes(helper)) {
        return helperEntitlements;
    }

    return file.endsWith(daemon) ? daemonEntitlements : null;
}

module.exports = async (options) => {
    const builderLib = createRequire(require.resolve('electron-builder/package.json')).resolve('app-builder-lib/package.json');
    const { signAsync } = createRequire(builderLib)('@electron/osx-sign');
    const optionsForFile = options.optionsForFile ?? (() => ({}));
    // Helpers a build only has for some architectures (the database helper exists for Apple silicon alone) or on macOS alone.
    const nativeHelpers = ['adecore-database', 'serve-sim-duo-hid', 'serve-sim-camera-helper', 'libSimCameraInjector.dylib'].map((name) =>
        join(options.app, 'Contents', 'Resources', 'bin', 'native', name)
    );
    await signAsync({
        ...options,
        binaries: [...(options.binaries ?? []), ...nativeHelpers.filter((helper) => existsSync(helper))],
        optionsForFile: (file) => {
            const entitlements = entitlementsFor(file);

            return entitlements === null ? optionsForFile(file) : { ...optionsForFile(file), entitlements };
        }
    });
};

module.exports.entitlementsFor = entitlementsFor;
