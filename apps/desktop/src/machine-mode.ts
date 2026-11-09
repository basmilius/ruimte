import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ServiceManager } from '@adecore/service';
import type { DaemonOwner, MachineMode } from '@ruimte/desktop-bridge';
import { serviceOwnership, type ServiceIdentity } from './service/ownership';

/*
 * Files in `userData` that show the app ran before this release. They only count while `machine.json`
 * is absent: the first start writes its decision there, and the files a start of `ask` leaves behind
 * must not read as an earlier install the second time. `local.key` is deliberately absent: a daemon
 * from `npx ruimte service install` leaves one, and that case asks.
 */
export const INSTALL_TRACES = [
    'background-service.json',
    'window-session.json',
    'window-state.json',
    'login-path.json',
    'storage-moved-to-app-scheme',
    'release-notes.json'
];

export interface MachineModeFacts {
    override: MachineMode | null;
    stored: MachineMode | null;
    traces: boolean;
    smoke: boolean;
}

interface MachineModeDecision {
    mode: MachineMode;
    /* What to store: `local` for a recognized earlier install, so an update never asks, and `ask` for a new one, so the next start asks again whatever the first left behind. */
    write: 'local' | 'ask' | null;
}

export interface MachineModeFile {
    read(): MachineMode | null;
    write(mode: MachineMode): void;
}

export function parseStoredMode(text: string | null): MachineMode | null {
    if (text === null) {
        return null;
    }
    try {
        const stored = JSON.parse(text) as { mode?: unknown } | null;
        return stored?.mode === 'local' || stored?.mode === 'none' || stored?.mode === 'ask' ? stored.mode : null;
    } catch {
        return null;
    }
}

export function parseModeOverride(value: string | undefined): MachineMode | null {
    return value === 'local' || value === 'none' || value === 'ask' ? value : null;
}

export function decideMachineMode(facts: MachineModeFacts): MachineModeDecision {
    if (facts.override) {
        return { mode: facts.override, write: null };
    }
    if (facts.stored) {
        return { mode: facts.stored, write: null };
    }
    if (facts.traces) {
        return { mode: 'local', write: 'local' };
    }
    // The smoke run tests the machine path unless it is told otherwise.
    return facts.smoke ? { mode: 'local', write: null } : { mode: 'ask', write: 'ask' };
}

export function machineModeFile(path: string): MachineModeFile {
    return {
        read() {
            try {
                return parseStoredMode(readFileSync(path, 'utf8'));
            } catch {
                return null;
            }
        },
        write(mode) {
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, `${JSON.stringify({ mode }, null, 2)}\n`);
        }
    };
}

export function hasInstallTraces(exists: (name: string) => boolean): boolean {
    return INSTALL_TRACES.some(exists);
}

export async function secretFor(mode: MachineMode, read: () => Promise<string | null>): Promise<string | null> {
    return mode === 'local' ? read() : null;
}

export function tildeHome(path: string, home: string): string {
    const rest = path.slice(home.length);
    return path.startsWith(home) && (rest === '' || rest[0] === '/' || rest[0] === '\\') ? `~${rest}` : path;
}

/*
 * The definition of this installation, taken away when the app stops running a machine. Its daemon may
 * be the app's own child, which a quit ends but which leaves the definition for the next login to start.
 * A service that runs the machine is taken down by the quit itself, and a definition of anyone else stays.
 */
export function removeOwnDefinition(manager: Pick<ServiceManager, 'read' | 'uninstall'> | null, identity: ServiceIdentity, owner: DaemonOwner | null): boolean {
    if (manager === null || owner === 'service' || serviceOwnership(manager.read(), identity) !== 'this') {
        return false;
    }
    manager.uninstall();
    return true;
}
