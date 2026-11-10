import { EndpointLeaveAccountResultSchema, MACHINE_LEAVE_ACCOUNT_PATH } from '@ruimte/contracts';
import { askLocalDaemon, commandIo, homeSecret, otherHome, tooOld, type LocalDaemonOptions } from './local-daemon.ts';

export type LogoutOptions = LocalDaemonOptions;

/*
 * `ruimte logout`: takes this machine off its account, the way Settings, Machines does in the app on it,
 * for a machine without the app. Only the local secret may, so it runs where the daemon's home is.
 */
export async function runLogout(options: LogoutOptions): Promise<number> {
    const { out, err } = commandIo(options);
    const secret = await homeSecret(options);
    if (secret === null) {
        err(`No daemon has started with ${options.home} as its home; start one first.`);
        return 1;
    }
    const response = await askLocalDaemon(options, secret, MACHINE_LEAVE_ACCOUNT_PATH, { method: 'POST' });
    if (!response) {
        err(`No daemon answers on port ${options.port}; start one first.`);
        return 1;
    }
    if (response.status === 404) {
        err(tooOld(options.port, 'logout'));
        return 1;
    }
    if (!response.ok) {
        err(otherHome(options));
        return 1;
    }
    const parsed = EndpointLeaveAccountResultSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
        err(`The daemon on port ${options.port} answered with something this command cannot read.`);
        return 1;
    }
    const { revoked } = parsed.data;
    out(
        revoked === 0
            ? 'This machine is on no account now. `ruimte login` puts it on one.'
            : `This machine is on no account now, and ${revoked === 1 ? '1 client' : `${revoked} clients`} that came in through it lost access. \`ruimte login\` puts it on one.`
    );
    return 0;
}
