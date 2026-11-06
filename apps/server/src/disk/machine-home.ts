import { readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { CodedError } from '@adecore/agents';
import { isBelow, isWithin } from '@adecore/utils/path';
import { homeFolder } from '@ruimte/service/home';
import { isChatVisualsPath, openHomeFolders } from './agent-folders.ts';
import { realOfNearest, realOrSelf } from './real-path.ts';

export class MachineHomeError extends CodedError<'machine-state'> {}

/*
 * What under `$RUIMTE_HOME` is not open (`openHomeFolders`, a chat's visuals) is the machine's: its key
 * pair, the local secret, the approvals, the secrets of launches, the accounts of the CLIs, the browser
 * profile and the threads of the chats beside their visuals.
 */
function isMachineState(home: string, path: string): boolean {
    return isWithin(home, path) && !openHomeFolders(home).some((folder) => isWithin(folder, path)) && !isChatVisualsPath(home, path);
}

const STATE_LIST_BYTES = 16 * 1024;

/* Whether a folder of the machine's state holds an open folder deeper down, so its entries are judged one by one. */
function holdsOpenFolder(home: string, folder: string): boolean {
    return folder === homeFolder(home, 'chats') || openHomeFolders(home).some((open) => isBelow(folder, open));
}

/* Every entry under `folder` that is the machine's state, as high up as the open folders allow. */
async function machineStateUnder(home: string, folder: string): Promise<string[]> {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    const found = await Promise.all(
        entries.map(async (entry) => {
            const path = join(folder, entry.name);
            if (!isMachineState(home, path)) {
                return [];
            }
            return entry.isDirectory() && holdsOpenFolder(home, path) ? await machineStateUnder(home, path) : [path];
        })
    );
    return found.flat();
}

/* The home as it is named and as it really is: what a search that cannot ask `MachineHome` itself (a worker) judges paths by. */
export interface MachineHomePolicy {
    homes: string[];
}

export const NO_MACHINE_HOME: MachineHomePolicy = { homes: [] };

/* Whether an absolute, resolved path is the machine's own state under either name of the home. */
export function isMachineStatePath(policy: MachineHomePolicy, path: string): boolean {
    return policy.homes.some((home) => isMachineState(home, path));
}

/* Whether a walk from `folder` reaches into the home, so that every name it meets has to be judged on its own. */
export function holdsMachineHome(policy: MachineHomePolicy, folder: string): boolean {
    return policy.homes.some((home) => isWithin(folder, home));
}

/*
 * The line a client's file and archive requests stop at. A client the machine let in is not its
 * owner, so nothing it asks for by path may hand it what only the local secret grants. A path is
 * judged by its name and by where it really leads, so neither a symlink nor another spelling on a
 * case-insensitive volume walks around it.
 */
export class MachineHome {
    private readonly home: string;
    private realHome: Promise<string> | null = null;

    constructor(home: string) {
        this.home = resolve(home);
    }

    async policy(): Promise<MachineHomePolicy> {
        this.realHome ??= realOrSelf(this.home);
        const realHome = await this.realHome;
        return { homes: realHome === this.home ? [this.home] : [this.home, realHome] };
    }

    async refuse(path: string): Promise<void> {
        await this.judge(path, isMachineStatePath);
    }

    /* Also refuses a folder the home lies in, for a request that acts on everything under the path it names. */
    async refuseHolding(path: string): Promise<void> {
        await this.judge(path, (policy, candidate) => isMachineStatePath(policy, candidate) || holdsMachineHome(policy, candidate));
    }

    /*
     * What a request over the whole of `folder` has to leave out: every entry of the machine's state
     * under a home that lies in it, relative to `folder` with forward slashes, the open folders kept.
     * Read from disk at the call, so an entry the machine makes after it is not in the list.
     */
    async stateWithin(folder: string): Promise<string[]> {
        const [policy, real] = await Promise.all([this.policy(), realOrSelf(resolve(folder))]);
        const tops = [...new Set([resolve(folder), real])];
        const found = new Set<string>();

        const relativeTo = (top: string, path: string): string => relative(top, path).split(sep).join('/');

        for (const top of tops) {
            for (const home of policy.homes.filter((candidate) => isWithin(top, candidate))) {
                const paths = (await machineStateUnder(home, home)).map((path) => relativeTo(top, path));
                const bytes = paths.reduce((total, path) => total + path.length + 20, 0);
                // The list goes on a git command line, which stops at 32 KB on Windows; past that the whole home stays out, open folders too.
                for (const path of bytes > STATE_LIST_BYTES ? [relativeTo(top, home)] : paths) {
                    found.add(path);
                }
            }
        }

        return [...found].sort();
    }

    private async judge(path: string, refused: (policy: MachineHomePolicy, path: string) => boolean): Promise<void> {
        const lexical = resolve(path);
        const [policy, real] = await Promise.all([this.policy(), realOfNearest(lexical)]);

        if (refused(policy, lexical) || refused(policy, real)) {
            throw new MachineHomeError('machine-state', `${path} belongs to this machine's own state and is not handed out`);
        }
    }
}
