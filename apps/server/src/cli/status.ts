import { commandIo, homeSecret, otherHome, startFirst, tooOld, type LocalDaemonOptions } from './local-daemon.ts';
import { readMachineStatus, statusLines } from './machine-status.ts';

interface StatusOptions extends LocalDaemonOptions {
    json?: boolean;
    check?: boolean;
}

/*
 * `ruimte status`: how clients reach the daemon running on this machine, asked on the local secret of
 * its home. Exits 0 when it answers and 1 when it does not, so a script can wait on it.
 */
export async function runStatus(options: StatusOptions): Promise<number> {
    const { fetcher, out, err } = commandIo(options);
    const secret = await homeSecret(options);
    if (secret === null) {
        err(`No daemon has started with ${options.home} as its home. ${startFirst(options.port)}`);
        return 1;
    }
    const answer = await readMachineStatus(options.port, secret, fetcher, options.check);
    if ('problem' in answer) {
        const problems = {
            'not-running': `No daemon answers on port ${options.port}. ${startFirst(options.port)}`,
            'other-home': otherHome(options),
            'too-old': tooOld(options.port, 'status')
        };
        err(problems[answer.problem]);
        return 1;
    }
    if (options.json) {
        out(JSON.stringify(answer.status, null, 2));
        return 0;
    }
    statusLines(answer.status, options.port).forEach(out);
    return 0;
}
