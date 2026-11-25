import { wait } from '@adecore/utils/async';
import { MACHINE_REGISTRATION_PATH } from '@ruimte/contracts';
import { RegisterMachinePayloadSchema } from '@ruimte/pulsar';
import { askLocalDaemon, commandIo, homeSecret, otherHome, startFirst, tooOld, type LocalDaemonOptions } from './local-daemon.ts';

export interface JoinOptions extends LocalDaemonOptions {
    accountId: string;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}

// It runs right after the machine was started, so the daemon gets this long to write its secret and answer.
export const JOIN_WAIT_MS = 30_000;
const JOIN_RETRY_MS = 500;

const ON_ANOTHER_ACCOUNT = 'This machine is on another account. Take it off that account first, with `ruimte logout` on this machine.';

/*
 * `ruimte join <account id>`: has the daemon of this home agree to be on that account and prints the signed
 * registration as one line of JSON, for whoever started the machine to post with a session of their own. It talks to
 * nobody but the daemon, on the local secret, so only a process on the machine itself can ask. What it prints is no
 * secret worth keeping from the person it is for: it puts this machine on that account and does nothing else.
 */
export async function runJoin(options: JoinOptions): Promise<number> {
    const { out, err } = commandIo(options);
    const sleep = options.sleep ?? wait;
    const now = options.now ?? Date.now;
    const giveUpAt = now() + JOIN_WAIT_MS;

    if (options.accountId === '') {
        err('Usage: ruimte join <account id>');

        return 1;
    }

    for (;;) {
        const secret = await homeSecret(options);
        const response =
            secret === null
                ? null
                : await askLocalDaemon(options, secret, MACHINE_REGISTRATION_PATH, { method: 'POST', body: { accountId: options.accountId } });

        if (response !== null) {
            return answered(response, options, out, err);
        }

        if (now() >= giveUpAt) {
            err(
                secret === null
                    ? `No daemon has started with ${options.home} as its home. ${startFirst(options.port)}`
                    : `No daemon answers on port ${options.port}. ${startFirst(options.port)}`
            );

            return 1;
        }

        await sleep(JOIN_RETRY_MS);
    }
}

async function answered(response: Response, options: JoinOptions, out: (line: string) => void, err: (line: string) => void): Promise<number> {
    if (response.status === 404) {
        err(tooOld(options.port, 'join'));

        return 1;
    }

    if (response.status === 409) {
        err(ON_ANOTHER_ACCOUNT);

        return 1;
    }

    if (response.status === 400) {
        err(`${options.accountId} is no account id.`);

        return 1;
    }

    if (!response.ok) {
        err(otherHome(options));

        return 1;
    }

    const parsed = RegisterMachinePayloadSchema.safeParse(await response.json().catch(() => null));

    if (!parsed.success) {
        err(`The daemon on port ${options.port} answered with something this command cannot read.`);

        return 1;
    }

    out(JSON.stringify(parsed.data));

    return 0;
}
