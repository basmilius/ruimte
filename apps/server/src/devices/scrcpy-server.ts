import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SCRCPY_PROTOCOL_VERSION } from './scrcpy-protocol.ts';
import { DeviceError } from './manager.ts';

/*
 * The screen server Ruimte pushes onto an Android device, pinned to the exact build the protocol in
 * `scrcpy-protocol.ts` was written for; the server refuses any client that names another version.
 * Apache-2.0, so its license travels beside it.
 */
export const SCRCPY_SERVER = {
    version: SCRCPY_PROTOCOL_VERSION,
    url: `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_PROTOCOL_VERSION}/scrcpy-server-v${SCRCPY_PROTOCOL_VERSION}`,
    sha256: 'deacb991ed2509715160ffdc7907e47b4160eb30d1566217e9047fd5b8850cae',
    licenseUrl: `https://raw.githubusercontent.com/Genymobile/scrcpy/v${SCRCPY_PROTOCOL_VERSION}/LICENSE`,
    licenseSha256: '01c12035bf35af37241298dc7ad538eb2a07e5c940437bc6876feeaa9d1951d0'
} as const;

export const SCRCPY_SERVER_FILE = 'scrcpy-server';
export const SCRCPY_LICENSE_FILE = 'scrcpy-server.LICENSE';

/* Beside the binary in a build; a development checkout fetches it into a folder git ignores. */
export const scrcpyServerDirectory = (compiled: boolean, executable: string, serverRoot: string): string =>
    compiled ? join(dirname(executable), 'native') : join(serverRoot, '.native', `scrcpy-v${SCRCPY_SERVER.version}`);

const sha256 = (bytes: Uint8Array): string => new Bun.CryptoHasher('sha256').update(bytes).digest('hex');

const fetchVerified = async (url: string, expected: string): Promise<Uint8Array> => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`${url} answered ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (sha256(bytes) !== expected) {
        throw new Error(`${url} does not match its pinned checksum`);
    }
    return bytes;
};

/* Puts the pinned server and its license in `directory`, verified against their checksums. */
export const downloadScrcpyServer = async (directory: string): Promise<void> => {
    await mkdir(directory, { recursive: true });
    const [server, license] = await Promise.all([
        fetchVerified(SCRCPY_SERVER.url, SCRCPY_SERVER.sha256),
        fetchVerified(SCRCPY_SERVER.licenseUrl, SCRCPY_SERVER.licenseSha256)
    ]);
    // Written aside and renamed, so a daemon never pushes half a file.
    const partial = join(directory, `${SCRCPY_SERVER_FILE}.partial`);
    await writeFile(partial, server);
    await rename(partial, join(directory, SCRCPY_SERVER_FILE));
    await writeFile(join(directory, SCRCPY_LICENSE_FILE), license);
};

/*
 * The path of the verified server, checked once per process. Only a development checkout downloads
 * it; a build that lacks it says so.
 */
export class ScrcpyServerFile {
    private readonly directory: string;
    private readonly download: boolean;
    private verified: Promise<string> | null = null;

    constructor(directory: string, download: boolean) {
        this.directory = directory;
        this.download = download;
    }

    get available(): boolean {
        return this.download || existsSync(join(this.directory, SCRCPY_SERVER_FILE));
    }

    path(): Promise<string> {
        this.verified ??= this.verify().catch((error: unknown) => {
            this.verified = null;
            throw error;
        });
        return this.verified;
    }

    private async verify(): Promise<string> {
        const path = join(this.directory, SCRCPY_SERVER_FILE);
        if (!existsSync(path)) {
            if (!this.download) {
                throw new DeviceError('scrcpy-unavailable', 'The Android screen server is not installed beside Ruimte');
            }
            try {
                await downloadScrcpyServer(this.directory);
            } catch (error) {
                throw new DeviceError(
                    'scrcpy-unavailable',
                    `The Android screen server could not be downloaded: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
        if (sha256(await readFile(path)) !== SCRCPY_SERVER.sha256) {
            throw new DeviceError('scrcpy-unavailable', 'The Android screen server beside Ruimte does not match its pinned checksum');
        }
        return path;
    }
}
