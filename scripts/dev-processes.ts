import { execFileSync } from 'node:child_process';

export interface OwnedProcess {
    pid?: number;
    exitCode?: number | null;
    signalCode?: NodeJS.Signals | null;
    kill(signal: NodeJS.Signals): boolean;
}

interface ProcessIdentity {
    pid: number;
    started: string;
}

const ownedMembers = new WeakMap<OwnedProcess, ProcessIdentity[]>();

const processIdentity = (pid: number): string | null => {
    try {
        return execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim() || null;
    } catch {
        return null;
    }
};

const rememberGroup = (child: OwnedProcess): void => {
    if (child.pid === undefined || ownedMembers.has(child)) {
        return;
    }
    try {
        const output = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,lstart='], { encoding: 'utf8' });
        const members = output
            .split('\n')
            .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
            .filter((match): match is RegExpMatchArray => match !== null && Number(match[2]) === child.pid)
            .map((match) => ({ pid: Number(match[1]), started: match[3] }));
        ownedMembers.set(child, members);
    } catch {
        ownedMembers.set(child, []);
    }
};

export const hasOwnedProcessMembers = (child: OwnedProcess): boolean =>
    (ownedMembers.get(child) ?? []).some(({ pid, started }) => processIdentity(pid) === started);

export const stopOwnedProcess = (
    child: OwnedProcess,
    signal: NodeJS.Signals,
    platform: NodeJS.Platform = process.platform,
    signalGroup: (pid: number, signal: NodeJS.Signals) => void = process.kill
): void => {
    if (platform !== 'win32' && child.pid !== undefined) {
        const exited = child.exitCode !== undefined && (child.exitCode !== null || child.signalCode !== null);
        if (signalGroup === process.kill) {
            rememberGroup(child);
            if (signal === 'SIGKILL' && exited) {
                for (const { pid, started } of ownedMembers.get(child) ?? []) {
                    if (processIdentity(pid) === started) {
                        try {
                            process.kill(pid, signal);
                        } catch {}
                    }
                }
                return;
            }
        } else if (exited) {
            return;
        }
        try {
            signalGroup(-child.pid, signal);
            return;
        } catch {
            child.kill(signal);
            return;
        }
    }
    if (child.exitCode !== undefined && (child.exitCode !== null || child.signalCode !== null)) {
        return;
    }
    child.kill(signal);
};

export const scheduleForcedStop = (
    children: readonly OwnedProcess[],
    delay = 5000
): ReturnType<typeof setTimeout> =>
    setTimeout(() => {
        for (const child of children) {
            stopOwnedProcess(child, 'SIGKILL');
        }
    }, delay);
