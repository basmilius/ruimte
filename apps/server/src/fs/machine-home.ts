import { realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CodedError } from '@adecore/agents/coded-error';
import { isInside } from '../canvas/project-paths.ts';

export class MachineHomeError extends CodedError<'machine-state'> {}

/*
 * What under `$RUIMTE_HOME` a person's own work or a picture made for them sits in: the Chats project,
 * the agents' worktrees, the shots agents take and the files people attach. The rest is the machine's:
 * its key pair, the local secret, the approvals, the accounts of the CLIs and the browser profile.
 */
const OPEN_FOLDERS = ['scratch', 'worktrees', 'screenshots', join('computer-use', 'screenshots'), 'attachments'];

function isMachineState(home: string, path: string): boolean {
    return isInside(home, path) && !OPEN_FOLDERS.some((folder) => isInside(join(home, folder), path));
}

/*
 * The line a client's file requests stop at. A paired client is not the owner of this machine, so
 * nothing it asks for by path may hand it what only the local secret grants. A path is judged by its
 * name and by where it really leads, so neither a symlink nor another spelling on a case-insensitive
 * volume walks around it.
 */
export class MachineHome {
    private readonly home: string;
    private realHome: Promise<string> | null = null;

    constructor(home: string) {
        this.home = resolve(home);
    }

    async refuse(path: string): Promise<void> {
        const lexical = resolve(path);
        this.realHome ??= realpath(this.home).catch(() => this.home);
        const [realHome, real] = await Promise.all([this.realHome, realpath(lexical).catch(() => lexical)]);
        if (isMachineState(this.home, lexical) || isMachineState(realHome, real)) {
            throw new MachineHomeError('machine-state', `${path} belongs to this machine's own state and is not handed out`);
        }
    }
}
