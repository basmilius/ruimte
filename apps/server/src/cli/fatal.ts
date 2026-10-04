import { DEFAULT_PORT } from '../config.ts';

/* What a person reads when a machine cannot start because its port is taken. */

/** Whether an error is the listen call finding its port taken. */
export function isAddressInUse(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'EADDRINUSE';
}

export interface RunningMachine {
    version: string;
    /* Whether it runs as the background service; null for a daemon from before `/health` said so. */
    service: boolean | null;
}

/** The answer of `GET /health` as a Ruimte machine gives it, or null for anything else. */
export function runningMachineFrom(body: unknown): RunningMachine | null {
    if (typeof body !== 'object' || body === null) {
        return null;
    }
    const { ok, version, service } = body as Record<string, unknown>;
    if (ok !== true || typeof version !== 'string') {
        return null;
    }
    return { version, service: typeof service === 'boolean' ? service : null };
}

/** Whether a Ruimte machine answers on the port of this computer, and which. Null for no answer or another program. */
export async function askRunningMachine(port: number): Promise<RunningMachine | null> {
    try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
        return runningMachineFrom(await response.json());
    } catch {
        return null;
    }
}

/** What to say when the port is taken, by a Ruimte machine (`running`) or by something else (null). */
export function portInUseMessage(port: number, running: RunningMachine | null): string {
    const portFlag = port === DEFAULT_PORT ? '' : ` --port ${port}`;
    if (running === null) {
        return `Port ${port} is in use by another program. Stop that program, or start Ruimte on a free port with --port.`;
    }
    const how = running.service === true ? ', as the background service' : '';
    const check = running.service === true ? `\`ruimte service status${portFlag}\` checks on it, ` : '';
    return (
        `A Ruimte machine is already running on port ${port} (version ${running.version}${how}).\n` +
        `There is no need to start another: ${check}\`ruimte login${portFlag}\` puts it on your account and \`ruimte status${portFlag}\` says how clients reach it. ` +
        'To run a second one anyway, give it its own --port and RUIMTE_HOME.'
    );
}
