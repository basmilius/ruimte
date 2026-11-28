import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import type { DevcontainerStart } from '@ruimte/desktop-bridge';
import { linuxArchOf, type ReadText } from '@ruimte/devcontainer';
import { DevcontainerStarts } from '../devcontainer-starts';
import { electron } from '../electron';
import { checkoutShellOrigin, npmOrigin } from '../linux-origin';
import { askLoginShellPath } from '../login-path';
import { runProgram } from '../program-run';
import type { DesktopIpc } from './ipc';

const { dialog } = electron;

// A devcontainer.json or a Dockerfile; anything larger is no such file.
const MAX_FILE_BYTES = 1_000_000;
// Where Docker Desktop, Homebrew and OrbStack put `docker`, for an app opened from the Dock whose login shell names none of them.
const DOCKER_FOLDERS = ['/usr/local/bin', '/opt/homebrew/bin', '/Applications/Docker.app/Contents/Resources/bin'];

interface DevcontainersOptions {
    /* The app's own folder, which keeps the Ruimte for Linux it downloaded. */
    userData: string;
    home: string;
    /* Set from a checkout, whose daemon the container runs instead of the published one. */
    checkout: string | null;
    version: string;
    send(start: DevcontainerStart): void;
}

/* A file of the folder a person picked, read by a path from that folder, which the shared reader only ever names inside it. */
function readerOf(folder: string): ReadText {
    return async (path) => {
        const file = join(folder, path);

        try {
            if ((await stat(file)).size > MAX_FILE_BYTES) {
                return { ok: false, error: { message: 'it is over 1 MB' } };
            }

            return { ok: true, value: await readFile(file, 'utf8') };
        } catch (e) {
            return { ok: false, error: { message: e instanceof Error ? e.message : String(e) } };
        }
    };
}

async function onPath(command: string, path: string | undefined): Promise<boolean> {
    for (const folder of (path ?? '').split(delimiter).filter((each) => each !== '')) {
        try {
            await access(join(folder, command), constants.X_OK);

            return true;
        } catch {
            // Not in this folder.
        }
    }

    return false;
}

function text(value: unknown): string {
    if (typeof value !== 'string' || value === '') {
        throw new Error('Expected a text');
    }

    return value;
}

/*
 * A folder in a dev container, for an app that runs no machine of its own. Installed only in machine mode `none` on
 * macOS and Linux. The folder comes from the picker the shell shows; the page names a start only by the id it got.
 */
export function installDevcontainers(ipc: DesktopIpc, options: DevcontainersOptions): void {
    let loginPath: Promise<string | null> | null = null;
    const env = async (): Promise<Record<string, string | undefined>> => {
        loginPath ??= askLoginShellPath(process.env.SHELL, process.platform);

        const path = [
            (await loginPath) ?? process.env.PATH ?? '',
            ...DOCKER_FOLDERS,
            join(options.home, '.docker', 'bin'),
            join(options.home, '.orbstack', 'bin')
        ];

        return { ...process.env, PATH: path.filter((each) => each !== '').join(delimiter) };
    };
    const arch = linuxArchOf(process.arch);
    const starts = new DevcontainerStarts({
        run: runProgram,
        readerOf,
        hasDocker: (environment) => onPath('docker', environment.PATH),
        env,
        origin: async () =>
            options.checkout !== null
                ? checkoutShellOrigin(arch, options.checkout)
                : npmOrigin({ version: options.version, arch, root: join(options.userData, 'linux-machines'), fetch, run: runProgram, env: await env() }),
        publish: options.send
    });

    ipc.handle('devcontainer:pick', async (event, accountId: unknown) => {
        const window = ipc.senderWindow(event);
        const account = text(accountId);

        if (!window) {
            return null;
        }

        const picked = await dialog.showOpenDialog(window, { properties: ['openDirectory'], message: 'Choose a folder with a devcontainer.json' });
        const folder = picked.canceled ? null : (picked.filePaths[0] ?? null);

        return folder === null ? null : starts.pick(folder, account);
    });
    ipc.handle('devcontainer:list', () => starts.list());
    ipc.handle('devcontainer:start', (_event, id: unknown, accountId: unknown, digest: unknown) => starts.start(text(id), text(accountId), text(digest)));
    ipc.handle('devcontainer:stop', (_event, id: unknown) => starts.stop(text(id)));
    ipc.handle('devcontainer:registration', (_event, id: unknown, accountId: unknown) => starts.registration(text(id), text(accountId)));
    ipc.handle('devcontainer:joined', (_event, id: unknown) => starts.joined(text(id)));
}
