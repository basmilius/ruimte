import { wait } from '@adecore/utils/async';
import { MACHINE_LINK_PATH, MACHINE_REGISTRATION_PATH } from '@ruimte/contracts';
import {
    AddressBookClient,
    AddressBookRequestError,
    DEVICE_LINK_COMPLETE_GRACE_MS,
    DeviceLinkStartPayloadSchema,
    RegisterMachinePayloadSchema,
    keyFingerprint,
    type Account,
    type DeviceLinkStartPayload,
    type DeviceLinkStartResult
} from '@ruimte/pulsar';
import type { z } from 'zod';
import { describeError } from '../error-text.ts';
import { askLocalDaemon, commandIo, homeSecret, otherHome, startFirst, tooOld, type LocalDaemonOptions } from './local-daemon.ts';
import { readMachineStatus, reachSentence } from './machine-status.ts';

export interface LoginOptions extends LocalDaemonOptions {
    // The address book; its production address when absent.
    addressBookUrl?: string;
    // Aborting withdraws the code and ends with 130, what a shell expects after Ctrl+C.
    signal?: AbortSignal;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    now?: () => number;
}

// A poll that reaches nobody this many times in a row is a network that is gone, not a hiccup.
const MAX_POLL_FAILURES = 5;

function whose(account: Account): string {
    return account.login === null ? 'your' : `${account.login}'s`;
}

class LoginFailure extends Error {}

const CODE_EXPIRED = 'The code expired before anyone approved it. Run `ruimte login` again for a new one.';

/* A poll that failed on the way rather than on its answer, which the next poll may get through. */
function passingFailure(e: unknown): boolean {
    return e instanceof AddressBookRequestError && (e.code === 'network' || e.code === 'internal' || e.code === 'rate-limited');
}

function printCode(out: (line: string) => void, request: DeviceLinkStartPayload, link: DeviceLinkStartResult, now: number): void {
    const minutes = Math.max(1, Math.round((link.expiresAt - now) / 60_000));
    out(`Linking ${request.name} to a Ruimte account.`);
    out(`Key fingerprint: ${keyFingerprint(request.publicKey)}`);
    out('');
    out('On any device, open this page and sign in:');
    out(`  ${link.verificationUriComplete}`);
    out('Check that it shows this code and this machine:');
    out(`  ${link.userCode}`);
    out('');
    out(`The code works for ${minutes} minutes. Waiting for approval (Ctrl+C to stop)...`);
}

const ON_ANOTHER_ACCOUNT =
    'This machine is on another account. Take it off that account first, with `ruimte logout` or under Settings, Machines in the app on this machine, then run `ruimte login` again.';

/*
 * `ruimte login`: puts this machine on an address book account without the app. The daemon signs, the
 * terminal carries the signatures to the address book, and a person approves the code on the web client.
 * Nothing the address book answers is worth anything to a thief: no session and no token, only which
 * account said yes. Runs where the daemon's home is, since the local secret is what lets it ask the
 * daemon to sign.
 */
export async function runLogin(options: LoginOptions): Promise<number> {
    const { fetcher, out, err } = commandIo(options);
    const sleep = options.sleep ?? wait;
    const now = options.now ?? Date.now;
    const book = new AddressBookClient({ baseUrl: options.addressBookUrl, fetch: fetcher });

    const secret = await homeSecret(options);
    if (secret === null) {
        err(`No daemon has started with ${options.home} as its home. ${startFirst(options.port)}`);
        return 1;
    }

    const askDaemon = async <T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> => {
        const response = await askLocalDaemon({ port: options.port, fetch: fetcher }, secret, path, { method: 'POST', body });
        if (!response) {
            throw new LoginFailure(`No daemon answers on port ${options.port}. ${startFirst(options.port)}`);
        }
        if (response.status === 404) {
            throw new LoginFailure(tooOld(options.port, 'login'));
        }
        if (response.status === 409) {
            throw new LoginFailure(ON_ANOTHER_ACCOUNT);
        }
        if (!response.ok) {
            throw new LoginFailure(otherHome(options));
        }
        const parsed = schema.safeParse(await response.json().catch(() => null));
        if (!parsed.success) {
            throw new LoginFailure(`The daemon on port ${options.port} answered with something this command cannot read.`);
        }
        return parsed.data;
    };

    let link: DeviceLinkStartResult | null = null;
    const withdraw = async (): Promise<number> => {
        if (link !== null) {
            await book.cancelDeviceLink({ deviceCode: link.deviceCode }).catch(() => undefined);
        }
        err('Stopped. The code no longer works.');
        return 130;
    };

    try {
        const request = await askDaemon(MACHINE_LINK_PATH, DeviceLinkStartPayloadSchema);
        link = await book.startDeviceLink(request);
        if (options.signal?.aborted) {
            return await withdraw();
        }
        printCode(out, request, link, now());

        let failures = 0;
        let interval = link.interval;
        // A bound of its own, so an address book that stops answering cannot keep the terminal forever.
        const giveUpAt = link.expiresAt + DEVICE_LINK_COMPLETE_GRACE_MS;
        while (now() < giveUpAt) {
            await sleep(interval * 1000, options.signal);
            if (options.signal?.aborted) {
                return await withdraw();
            }
            let poll;
            try {
                poll = await book.pollDeviceLink({ deviceCode: link.deviceCode });
                failures = 0;
            } catch (e) {
                if (passingFailure(e) && ++failures < MAX_POLL_FAILURES) {
                    continue;
                }
                throw e;
            }
            interval = poll.interval;
            switch (poll.status) {
                case 'pending':
                    continue;
                case 'denied':
                    err('Someone denied this machine on the approval page. Nothing was added.');
                    return 1;
                case 'cancelled':
                    err('The code was withdrawn. Run `ruimte login` again for a new one.');
                    return 1;
                case 'expired':
                    err(CODE_EXPIRED);
                    return 1;
                case 'approved': {
                    if (poll.account === null) {
                        continue;
                    }
                    const approved = link;
                    // A machine that refuses the account leaves the approval unused, so the code stops working on the page too.
                    const registration = await askDaemon(MACHINE_REGISTRATION_PATH, RegisterMachinePayloadSchema, { accountId: poll.account.id }).catch(
                        async (e: unknown) => {
                            await book.cancelDeviceLink({ deviceCode: approved.deviceCode }).catch(() => undefined);
                            throw e;
                        }
                    );
                    const result = await book.completeDeviceLink({
                        deviceCode: link.deviceCode,
                        issuedAt: registration.issuedAt,
                        signature: registration.signature
                    });
                    out(`Added to ${whose(result.account)} account. Clients signed in to it can open ${result.machine.name} now.`);
                    // A daemon from before `ruimte status` says nothing about its ways in, and the login stands without it.
                    const reach = await readMachineStatus(options.port, secret, fetcher);
                    if ('status' in reach) {
                        out(reachSentence(reach.status));
                    }
                    return 0;
                }
            }
        }
        err(CODE_EXPIRED);
        return 1;
    } catch (e) {
        if (e instanceof LoginFailure) {
            err(e.message);
        } else if (e instanceof AddressBookRequestError) {
            err(`The address book refused: ${e.message}`);
        } else {
            err(describeError(e, false));
        }
        return 1;
    }
}
