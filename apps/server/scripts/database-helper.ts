import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { helperPath } from '@adecore/database/host';

export interface PinnedPackage {
    version: string;
    integrity: string;
}

function escapeForPattern(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/* The version and integrity `bun.lock` pins for a package, or null when it pins none. */
export function pinnedIn(lock: string, name: string): PinnedPackage | null {
    const escaped = escapeForPattern(name);
    const match = new RegExp(`"${escaped}": \\["${escaped}@([^"]+)", "[^"]*", \\{[^}]*\\}, "(sha512-[^"]+)"\\]`).exec(lock);
    return match ? { version: match[1]!, integrity: match[2]! } : null;
}

/* The package as npm serves it, unpacked into a folder of its own, after its bytes matched what the lockfile pins. */
async function fetchPinned(name: string, pinned: PinnedPackage, into: string): Promise<string> {
    const url = `https://registry.npmjs.org/${name}/-/${name.split('/')[1]}-${pinned.version}.tgz`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${url} answered ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (`sha512-${new Bun.CryptoHasher('sha512').update(bytes).digest('base64')}` !== pinned.integrity) {
        throw new Error(`${url} does not match the integrity bun.lock pins`);
    }
    const archive = join(into, 'package.tgz');
    await writeFile(archive, bytes);
    const unpack = Bun.spawnSync(['tar', '-xzf', archive, '-C', into], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (unpack.exitCode !== 0) {
        throw new Error(`Unpacking ${archive} failed`);
    }
    return join(into, 'package');
}

/*
 * Puts the helper of `@adecore/database` for a target in `nativeDir`, with the license its package
 * ships. The target's platform package is only installed on a host of the same platform, so a cross
 * build fetches it from the registry at the version `bun.lock` pins. A target without a package
 * builds without the helper, and that daemon answers every database request `helper-unavailable`.
 */
export async function placeDatabaseHelper(root: string, nativeDir: string, platform: string, arch: string): Promise<void> {
    const name = `@adecore/database-${platform}-${arch}`;
    const file = platform === 'win32' ? 'adecore-database.exe' : 'adecore-database';
    const pinned = pinnedIn(await readFile(join(root, '..', '..', 'bun.lock'), 'utf8'), name);
    if (pinned === null) {
        console.warn(`There is no ${name}, so this build has no database helper.`);
        return;
    }
    const installed = helperPath({ platform, arch });
    const scratch = installed === null ? await mkdtemp(join(tmpdir(), 'ruimte-database-helper-')) : null;
    try {
        const packageDir = installed === null ? await fetchPinned(name, pinned, scratch!) : dirname(dirname(installed));
        await mkdir(nativeDir, { recursive: true });
        const helper = join(nativeDir, file);
        await copyFile(join(packageDir, 'bin', file), helper);
        await chmod(helper, 0o755);
        await copyFile(join(packageDir, 'LICENSE'), join(nativeDir, 'adecore-database.LICENSE'));
    } finally {
        if (scratch !== null) {
            await rm(scratch, { recursive: true, force: true });
        }
    }
}
