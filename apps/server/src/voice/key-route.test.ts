import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { MACHINE_PROOF_PATH, MACHINE_VOICE_KEY_PATH } from '@ruimte/contracts';
import { clearVoiceKey, handVoiceKey, type DaemonPort } from '../../../desktop/src/daemon-proof.ts';
import { handleLocalProofRequest } from '../auth/local-proof.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { handleVoiceKeyRequest } from './key-route.ts';
import { VoiceKeyStore } from './key-store.ts';

const SECRET = 'the-local-secret';
const PORT = 4210;
const KEY = 'sk-test-voice-0123456789abcdef';

const newHome = tempHomes('ruimte-voice-key-route-');

/* The shell's side as the desktop app runs it, against the daemon's routes on a real key store in a home of its own. */
async function machine(): Promise<{ daemon: DaemonPort; home: string }> {
    const home = join(await newHome(), 'home');
    const keys = new VoiceKeyStore(home);
    const access = { localSecret: SECRET, tickets: { ticketAccess: async () => null } };
    const daemon: DaemonPort = {
        port: PORT,
        readSecret: async () => SECRET,
        nonce: () => 'a-fresh-nonce-for-every-ask',
        fetch: async (url, init) => {
            const request = new Request(url, init);
            const path = new URL(url).pathname;

            if (path === MACHINE_PROOF_PATH) {
                return handleLocalProofRequest(request, { localSecret: SECRET, port: PORT });
            }

            if (path === MACHINE_VOICE_KEY_PATH) {
                return handleVoiceKeyRequest(request, '127.0.0.1', access, keys);
            }

            return new Response('Not found', { status: 404 });
        }
    };

    return { daemon, home };
}

describe('the Voice key between the shell and the daemon', () => {
    test('a key removed in the app is gone from the machine too, also for a daemon that starts again', async () => {
        const { daemon, home } = await machine();

        expect(await handVoiceKey(daemon, KEY)).toBe(true);
        expect(await new VoiceKeyStore(home).read()).toBe(KEY);
        expect(await clearVoiceKey(daemon)).toBe(true);
        expect(await new VoiceKeyStore(home).read()).toBeNull();
    });

    test('a removal the daemon did not take is reported, and its copy stays', async () => {
        const { daemon, home } = await machine();
        await handVoiceKey(daemon, KEY);
        const stranger: DaemonPort = { ...daemon, readSecret: async () => 'another-secret' };

        expect(await clearVoiceKey(stranger)).toBe(false);
        expect(await new VoiceKeyStore(home).read()).toBe(KEY);
    });
});
