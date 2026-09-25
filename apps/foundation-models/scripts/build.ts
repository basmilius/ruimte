import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('The Foundation Models helper requires an Apple silicon Mac to build.');
}
const root = fileURLToPath(new URL('../', import.meta.url));
const build = Bun.spawn(['swift', 'build', '--package-path', root, '-c', 'release', '--arch', 'arm64'], { stdout: 'inherit', stderr: 'inherit' });
if ((await build.exited) !== 0) {
    throw new Error('Foundation Models helper build failed.');
}
const folder = join(root, 'dist');
await mkdir(folder, { recursive: true });
const destination = join(folder, 'ruimte-foundation-models');
await copyFile(join(root, '.build', 'release', 'ruimte-foundation-models'), destination);
await copyFile(join(root, 'THIRD_PARTY_NOTICES.txt'), join(folder, 'ruimte-foundation-models.NOTICES'));
await chmod(destination, 0o755);
console.log(destination);
