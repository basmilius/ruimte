import { stat } from 'node:fs/promises';
import type { InstallerPorts } from './cloudflared-installer.ts';

const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

/* The installer's ports on this machine: `which`, the network, `tar` and the sha256 of Bun. */
export function realInstallerPorts(): InstallerPorts {
    return {
        platform: process.platform,
        arch: process.arch,
        onPath: () => Bun.which('cloudflared'),
        exists: async (path) => (await stat(path).catch(() => null))?.isFile() === true,
        download: async (url) => {
            const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });

            if (!response.ok) {
                throw new Error(`Answered ${response.status}`);
            }

            return new Uint8Array(await response.arrayBuffer());
        },
        extract: async (archive, folder) => {
            const child = Bun.spawn(['tar', '-xzf', archive, '-C', folder], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });

            if ((await child.exited) !== 0) {
                throw new Error('tar could not unpack the download');
            }
        },
        sha256: (bytes) => new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
    };
}
