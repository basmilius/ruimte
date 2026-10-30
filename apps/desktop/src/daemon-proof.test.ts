import { describe, expect, test } from 'bun:test';
import {
    localProofOf,
    MACHINE_HEALTH_PATH,
    MACHINE_SHUTDOWN_PATH,
    MACHINE_PROOF_PATH,
    MachineProofRequestSchema,
    MACHINE_VOICE_KEY_PATH,
    MACHINE_WORK_PATH
} from '@ruimte/contracts';
import { askDaemonWork, handVoiceKey, proveDaemon, stopDaemonGently, type DaemonPort } from './daemon-proof';

const SECRET = 'the-local-secret';

interface Asked {
    path: string;
    authorization: string | null;
}

/* Whatever holds the port: it answers the proof as `prove` says and the work to anyone who asks. */
function holder(prove: (nonce: string) => Promise<string | null>) {
    const asked: Asked[] = [];
    const handed: string[] = [];
    const daemon: DaemonPort = {
        port: 4210,
        readSecret: async () => SECRET,
        nonce: () => 'a-fresh-nonce-for-every-ask',
        fetch: async (url, init) => {
            const path = new URL(url).pathname;
            asked.push({ path, authorization: new Headers(init.headers).get('authorization') });
            if (path === MACHINE_PROOF_PATH) {
                const { nonce } = MachineProofRequestSchema.parse(JSON.parse(String(init.body)));
                const proof = await prove(nonce);
                return proof === null ? new Response('Not found', { status: 404 }) : Response.json({ proof });
            }
            if (path === MACHINE_WORK_PATH) {
                return Response.json({ terminals: 1, agents: 2 });
            }
            if (path === MACHINE_VOICE_KEY_PATH) {
                handed.push(JSON.parse(String(init.body)).key);
                return new Response(null, { status: 204 });
            }
            return new Response('Not found', { status: 404 });
        }
    };
    return { daemon, asked, handed };
}

describe('proveDaemon', () => {
    test('a daemon that holds the secret proves it', async () => {
        const { daemon } = holder((nonce) => localProofOf(SECRET, 4210, nonce));
        expect(await proveDaemon(daemon)).toBe(true);
    });

    test('something without the route, or with a proof it made up, does not', async () => {
        expect(await proveDaemon(holder(async () => null).daemon)).toBe(false);
        expect(await proveDaemon(holder(async () => 'made-up').daemon)).toBe(false);
        expect(await proveDaemon(holder((nonce) => localProofOf('another-secret', 4210, nonce)).daemon)).toBe(false);
    });

    test('a daemon of the same home on another port cannot answer for this one', async () => {
        expect(await proveDaemon(holder((nonce) => localProofOf(SECRET, 4300, nonce)).daemon)).toBe(false);
    });
});

describe('stopDaemonGently', () => {
    const provenPort = (answer: (path: string) => Response): { daemon: DaemonPort; asked: string[] } => {
        const asked: string[] = [];
        const daemon: DaemonPort = {
            port: 4210,
            readSecret: async () => SECRET,
            nonce: () => 'a-fresh-nonce-for-every-ask',
            fetch: async (url, init) => {
                const path = new URL(url).pathname;
                if (path === MACHINE_PROOF_PATH) {
                    const { nonce } = MachineProofRequestSchema.parse(JSON.parse(String(init.body)));
                    return Response.json({ proof: await localProofOf(SECRET, 4210, nonce) });
                }
                asked.push(`${init.method ?? 'GET'} ${path}`);
                return answer(path);
            }
        };
        return { daemon, asked };
    };

    test('asks once and waits until the port stops answering', async () => {
        let healthy = 2;
        const { daemon, asked } = provenPort((path) => {
            if (path === MACHINE_HEALTH_PATH && healthy-- === 0) {
                throw new Error('refused');
            }
            return new Response(null, { status: path === MACHINE_SHUTDOWN_PATH ? 202 : 200 });
        });
        expect(await stopDaemonGently(daemon, async () => undefined)).toBe(true);
        expect(asked.filter((line) => line === `POST ${MACHINE_SHUTDOWN_PATH}`)).toHaveLength(1);
        expect(asked.filter((line) => line === `GET ${MACHINE_HEALTH_PATH}`)).toHaveLength(3);
    });

    test('leaves a daemon without the request, and one that stays up, to the hard stop', async () => {
        const unknown = provenPort(() => new Response('Not found', { status: 404 }));
        expect(await stopDaemonGently(unknown.daemon, async () => undefined)).toBe(false);
        expect(unknown.asked).toEqual([`POST ${MACHINE_SHUTDOWN_PATH}`]);
        const busy = provenPort(() => new Response(null, { status: 202 }));
        expect(await stopDaemonGently(busy.daemon, async () => undefined, 3)).toBe(false);
    });

    test('leaves a daemon that accepted the stop and then hangs to the hard stop within a few tries', async () => {
        const { daemon, asked } = provenPort((path) => {
            if (path === MACHINE_HEALTH_PATH) {
                throw new DOMException('timed out', 'TimeoutError');
            }
            return new Response(null, { status: 202 });
        });
        expect(await stopDaemonGently(daemon, async () => undefined)).toBe(false);
        expect(asked.filter((line) => line === `GET ${MACHINE_HEALTH_PATH}`)).toHaveLength(5);
    });
});

describe('askDaemonWork', () => {
    test('something that answers health but cannot prove the secret never gets it', async () => {
        const { daemon, asked } = holder(async () => 'made-up');
        expect(await askDaemonWork(daemon)).toBeNull();
        expect(asked.map((entry) => entry.path)).toEqual([MACHINE_PROOF_PATH]);
        expect(asked.every((entry) => entry.authorization === null)).toBe(true);
    });

    test('a daemon that proved the secret is asked with it', async () => {
        const { daemon, asked } = holder((nonce) => localProofOf(SECRET, 4210, nonce));
        expect(await askDaemonWork(daemon)).toEqual({ terminals: 1, agents: 2 });
        expect(asked.at(-1)).toEqual({ path: MACHINE_WORK_PATH, authorization: `Bearer ${SECRET}` });
    });
});

describe('handVoiceKey', () => {
    test('the key reaches only a daemon that proved the secret', async () => {
        const { daemon, asked, handed } = holder(async () => 'made-up');
        expect(await handVoiceKey(daemon, 'sk-test')).toBe(false);
        expect(asked.map((entry) => entry.path)).toEqual([MACHINE_PROOF_PATH]);
        expect(handed).toEqual([]);
    });

    test('a daemon that proved the secret takes the key with it', async () => {
        const { daemon, asked, handed } = holder((nonce) => localProofOf(SECRET, 4210, nonce));
        expect(await handVoiceKey(daemon, 'sk-test')).toBe(true);
        expect(asked.at(-1)).toEqual({ path: MACHINE_VOICE_KEY_PATH, authorization: `Bearer ${SECRET}` });
        expect(handed).toEqual(['sk-test']);
    });
});
