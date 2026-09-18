// electron-builder copies `extraResources` from a folder that may not exist (a daemon not compiled for
// this arch) without a word, which would ship an app that cannot start. Refuse to package that.
const { existsSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async (context) => {
    const resources =
        context.electronPlatformName === 'darwin'
            ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
            : join(context.appOutDir, 'resources');
    const names = ['ruimte', 'ruimte-context', 'ruimte.build', 'ruimte.bundle.json'];
    if (context.electronPlatformName === 'darwin') {
        names.push('ruimte-simulator-helper', 'native/serve-sim-ax-settings', 'native/serve-sim-native.node');
    }
    const missing = names.map((name) => join(resources, 'bin', name)).find((path) => !existsSync(path));
    if (missing) {
        throw new Error(`Native bundle is missing ${missing}; run \`bun run --cwd apps/server-rust compile\` for this os and arch first`);
    }
    if (!existsSync(join(resources, 'client', 'index.html'))) {
        throw new Error('No built client; run `bun run --cwd apps/client build` first');
    }
};
