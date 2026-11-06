import type { MachineHealth } from '@ruimte/service/health';
import { portFlag } from '../config.ts';

/* What a person reads when a machine cannot start because its port is taken. */

/** Whether an error is the listen call finding its port taken. */
export function isAddressInUse(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'EADDRINUSE';
}

export type RunningMachine = Pick<MachineHealth, 'version' | 'service'>;

/** What to say when the port is taken, by a Ruimte machine (`running`) or by something else (null). */
export function portInUseMessage(port: number, running: RunningMachine | null): string {
    const flag = portFlag(port);
    if (running === null) {
        return `Port ${port} is in use by another program. Stop that program, or start Ruimte on a free port with --port.`;
    }
    const how = running.service === true ? ', as the background service' : '';
    const check = running.service === true ? `\`ruimte service status${flag}\` checks on it, ` : '';
    return (
        `A Ruimte machine is already running on port ${port} (version ${running.version}${how}).\n` +
        `There is no need to start another: ${check}\`ruimte login${flag}\` puts it on your account and \`ruimte status${flag}\` says how clients reach it. ` +
        'To run a second one anyway, give it its own --port and RUIMTE_HOME.'
    );
}
