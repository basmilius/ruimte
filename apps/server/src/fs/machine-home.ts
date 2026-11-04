import { join, relative, resolve, sep } from 'node:path';
import { CodedError } from '@adecore/agents';
import { DEVICE_CAPTURES_FOLDER } from '../shots.ts';
import { isInside } from '../tools/project-paths.ts';
import { realOrSelf } from './real-path.ts';

export class MachineHomeError extends CodedError<'machine-state'> {}

/*
 * What under `$RUIMTE_HOME` holds a person's own work or a picture made for them: the Chats project,
 * the agents' worktrees, the shots agents take, a person's captures of a device, the files people
 * attach and the visuals of a chat. The rest is the machine's: its key pair, the local secret, the
 * approvals, the secrets of launches, the accounts of the CLIs, the browser profile and the threads
 * of the chats beside their visuals.
 */
const OPEN_FOLDERS = ['scratch', 'worktrees', 'screenshots', join('computer-use', 'screenshots'), 'attachments', DEVICE_CAPTURES_FOLDER];

function isChatVisuals(home: string, path: string): boolean {
    const chats = join(home, 'chats');
    if (!isInside(chats, path)) {
        return false;
    }
    const folder = relative(chats, path).split(sep)[0]!;
    return folder.endsWith('.visuals');
}

function isMachineState(home: string, path: string): boolean {
    return isInside(home, path) && !OPEN_FOLDERS.some((folder) => isInside(join(home, folder), path)) && !isChatVisuals(home, path);
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
    return policy.homes.some((home) => isInside(folder, home));
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
        const lexical = resolve(path);
        const [policy, real] = await Promise.all([this.policy(), realOrSelf(lexical)]);
        if (isMachineStatePath(policy, lexical) || isMachineStatePath(policy, real)) {
            throw new MachineHomeError('machine-state', `${path} belongs to this machine's own state and is not handed out`);
        }
    }
}
