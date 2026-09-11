import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Compiles `assets/AppIcon.icon` (Icon Composer) into the two things a macOS 26 bundle wants:
 * `Assets.car`, which carries the icon in every appearance the system tints it with, and
 * `AppIcon.icns` for whoever still asks for a file. Both land in `build/icon`, committed, so
 * packaging never needs Xcode: actool only reads `.icon` from Xcode 26 on, and the runner that
 * builds a release may carry an older one.
 *
 *   bun scripts/icon.ts
 */
const root = join(import.meta.dirname, '..');
const source = join(root, '..', '..', 'assets', 'AppIcon.icon');
const out = join(root, 'build', 'icon');
const partial = join(out, 'partial.plist');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const actool = spawnSync(
    'xcrun',
    [
        'actool',
        '--output-format',
        'human-readable-text',
        '--notices',
        '--warnings',
        '--errors',
        '--app-icon',
        'AppIcon',
        '--output-partial-info-plist',
        partial,
        '--enable-on-demand-resources',
        'NO',
        '--development-region',
        'en',
        '--target-device',
        'mac',
        '--minimum-deployment-target',
        '26.0',
        '--platform',
        'macosx',
        '--compile',
        out,
        source
    ],
    { cwd: root, stdio: 'inherit' }
);
if (actool.status !== 0) {
    process.exit(actool.status ?? 1);
}

rmSync(partial, { force: true });

for (const name of ['Assets.car', 'AppIcon.icns']) {
    if (!existsSync(join(out, name))) {
        console.error(`actool wrote no ${name}; is ${source} an Icon Composer document?`);
        process.exit(1);
    }
}

console.log(`Compiled the icon into ${out}`);
