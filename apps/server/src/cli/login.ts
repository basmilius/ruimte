import {
    AddressBookClient,
    AddressBookRequestError,
    DEVICE_LINK_COMPLETE_GRACE_MS,
    DeviceLinkStartPayloadSchema,
    RegisterMachinePayloadSchema,
    keyFingerprint,
    type Account,
    type DeviceLinkStartResult
} from '@ruimte/pulsar';
import type { z } from 'zod';
import { readLocalSecret } from '../auth/local-secret.ts';
import { describeError } from '../error-text.ts';

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface LoginOptions {
    port: number;
    home: string;
    // The address book; its production address when absent.
    addressBookUrl?: string;
    // Aborting withdraws the code and ends with 130, what a shell expects after Ctrl+C.
    signal?: AbortSignal;
    fetch?: Fetch;
    readSecret?: (home: string) => Promise<string>;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    now?: () => number;
    out?: (line: string) => void;
    err?: (line: string) => void;
}

// A poll that reaches nobody this many times in a row is a network that is gone, not a hiccup.
const MAX_POLL_FAILURES = 5;

const sleepFor = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true }
        );
    });

const whose = (account: Account): string => (account.login === null ? 'your' : `${account.login}'s`);

class LoginFailure extends Error {}

/*
 * `ruimte login`: puts this machine on an address book account without the app. The daemon signs, the
 * terminal carries the signatures to the address book, and a person approves the code on the web client.
 * Nothing the address book answers is worth anything to a thief: no session and no token, only which
 * account said yes. Runs where the daemon's home is, since the local secret is what lets it ask the
 * daemon to sign.
 */
export const runLogin = async (options: LoginOptions): Promise<number> => {
    const fetcher: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
    const sleep = options.sleep ?? sleepFor;
    const now = options.now ?? Date.now;
    const out = options.out ?? ((line: string) => console.log(line));
    const err = options.err ?? ((line: string) => console.error(line));
    const book = new AddressBookClient({ baseUrl: options.addressBookUrl, fetch: fetcher });

    const secret = await (options.readSecret ?? readLocalSecret)(options.home).catch(() => null);
    if (secret === null) {
        err(`No daemon has started with ${options.home} as its home; start one first.`);
        return 1;
    }

    const askDaemon = async <T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> => {
        const response = await fetcher(`http://127.0.0.1:${options.port}${path}`, {
            method: 'POST',
            headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body)
        }).catch(() => null);
        if (!response) {
            throw new LoginFailure(`No daemon answers on port ${options.port}; start one first.`);
        }
        if (response.status === 404) {
            throw new LoginFailure(`The daemon on port ${options.port} is older than \`ruimte login\`; update it first.`);
        }
        if (!response.ok) {
            throw new LoginFailure(`The daemon on port ${options.port} does not use ${options.home}; set RUIMTE_HOME to the home it was started with.`);
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
        const request = await askDaemon('/machine/link-request', DeviceLinkStartPayloadSchema);
        link = await book.startDeviceLink(request);
        if (options.signal?.aborted) {
            return await withdraw();
        }
        const minutes = Math.max(1, Math.round((link.expiresAt - now()) / 60_000));
        out(`Linking ${request.name} to a Ruimte account.`);
        out(`Key fingerprint: ${keyFingerprint(request.publicKey)}`);
        out('');
        out('On any device, open this page and sign in:');
        out(`  ${link.verificationUriComplete}`);
        out('Check that it shows this code and this machine:');
        out(`  ${link.userCode}`);
        out('');
        out(`The code works for ${minutes} minutes. Waiting for approval (Ctrl+C to stop)...`);

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
                const passing = e instanceof AddressBookRequestError && (e.code === 'network' || e.code === 'internal' || e.code === 'rate-limited');
                if (passing && ++failures < MAX_POLL_FAILURES) {
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
                    err('The code expired before anyone approved it. Run `ruimte login` again for a new one.');
                    return 1;
                case 'approved': {
                    if (poll.account === null) {
                        continue;
                    }
                    const registration = await askDaemon('/machine/registration', RegisterMachinePayloadSchema, { accountId: poll.account.id });
                    const result = await book.completeDeviceLink({
                        deviceCode: link.deviceCode,
                        issuedAt: registration.issuedAt,
                        signature: registration.signature
                    });
                    out(`Added to ${whose(result.account)} account. Clients signed in to it can open ${result.machine.name} now.`);
                    return 0;
                }
            }
        }
        err('The code expired before anyone approved it. Run `ruimte login` again for a new one.');
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
};
