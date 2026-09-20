// electron-builder copies `extraResources` from a folder that may not exist (a daemon not compiled for
// this arch) without a word, which would ship an app that cannot start. Refuse to package that.
const { existsSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async (context) => {
    const resources =
        context.electronPlatformName === 'darwin'
            ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
            : join(context.appOutDir, 'resources');
    const daemon = join(resources, 'bin', context.electronPlatformName === 'win32' ? 'ruimte.exe' : 'ruimte');
    if (!existsSync(daemon)) {
        throw new Error(`No daemon at ${daemon}; run \`bun run --cwd apps/server compile\` for this os and arch first`);
    }
    // Speech to Text ships on macOS only; see `apps/speech-bridge/README.md`.
    if (context.electronPlatformName === 'darwin' && !existsSync(join(resources, 'bin', 'native', 'speech-bridge'))) {
        throw new Error('No speech helper; compile the server resources for this os and arch first');
    }
    if (!existsSync(join(resources, 'client', 'index.html'))) {
        throw new Error('No built client; run `bun run --cwd apps/client build` first');
    }
};
