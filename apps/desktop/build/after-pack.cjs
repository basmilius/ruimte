// electron-builder copies `extraResources` from a folder that may not exist (a daemon not compiled for
// this arch) without a word, which would ship an app that cannot start. Refuse to package that.
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const COMPILE_HINT = 'compile the server resources for this os and arch first';

function expectFiles(paths, message) {
    if (!paths.every((path) => existsSync(path))) {
        throw new Error(message);
    }
}

module.exports = async (context) => {
    const platform = context.electronPlatformName;
    const resources =
        platform === 'darwin'
            ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
            : join(context.appOutDir, 'resources');
    const bin = join(resources, 'bin');
    const native = join(bin, 'native');
    const daemon = join(bin, platform === 'win32' ? 'ruimte.exe' : 'ruimte');
    expectFiles([daemon], `No daemon at ${daemon}; run \`bun run --cwd apps/server compile\` for this os and arch first`);
    if (platform === 'win32') {
        for (const name of ['ruimte-context.exe', join('native', 'adecore-database.exe')]) {
            expectFiles([join(bin, name)], `No ${name} in ${bin}; run \`bun run --cwd apps/server compile -- --os win --arch x64\` first`);
        }
    }
    if (platform === 'darwin') {
        // Speech to Text ships on macOS only; see `apps/speech-bridge/README.md`.
        expectFiles([join(native, 'speech-bridge')], `No speech helper; ${COMPILE_HINT}`);
        expectFiles([join(native, 'serve-sim-duo-hid')], `No iPhone Duo guest helper; ${COMPILE_HINT}`);
        expectFiles([join(native, 'serve-sim-camera-helper'), join(native, 'libSimCameraInjector.dylib')], `No simulator camera helper; ${COMPILE_HINT}`);
        expectFiles(
            [join(resources, '..', 'Helpers', 'Ruimte Computer Use.app', 'Contents', 'MacOS', 'RuimteComputerUse')],
            `No computer use helper; ${COMPILE_HINT}`
        );
    }
    expectFiles([join(resources, 'client', 'index.html')], 'No built client; run `bun run --cwd apps/client build` first');
};
