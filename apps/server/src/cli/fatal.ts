import type { MachineHealth } from '@ruimte/service/health';
import { portFlag } from '../config.ts';

export function isAddressInUse(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'EADDRINUSE';
}

export type RunningMachine = Pick<MachineHealth, 'version' | 'service'> & Partial<Pick<MachineHealth, 'starting'>>;

/**
 * What to say when the port is taken, by a Ruimte machine (`running`) or by something else (null).
 * A machine that is still starting here was waited for already, so it is a slow start and not another program.
 */
export function portInUseMessage(port: number, running: RunningMachine | null): string {
    const flag = portFlag(port);
    if (running === null) {
        return `Port ${port} is in use by another program. Stop that program, or start Ruimte on a free port with --port.`;
    }
    if (running.starting) {
        return `A Ruimte machine is already starting on port ${port} (version ${running.version}) and has not finished yet. There is no need to start another: try \`ruimte status${flag}\` in a moment.`;
    }
    const how = running.service === true ? ', as the background service' : '';
    const check = running.service === true ? `\`ruimte service status${flag}\` checks on it, ` : '';
    return (
        `A Ruimte machine is already running on port ${port} (version ${running.version}${how}).\n` +
        `There is no need to start another: ${check}\`ruimte login${flag}\` puts it on your account and \`ruimte status${flag}\` says how clients reach it. ` +
        'To run a second one anyway, give it its own --port and RUIMTE_HOME.'
    );
}
