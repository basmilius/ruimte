import { beforeEach, describe, expect, test } from 'bun:test';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifySignature } from '@ruimte/pulsar/verify-node';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { PEER_KEY_FILE, PeerKey } from './peer-key.ts';

const newHome = tempHomes('ruimte-peer-key-');
let home: string;

beforeEach(async () => {
    home = await newHome();
});

describe('the peer key', () => {
    test('is made on first use, kept private and the same after a restart', async () => {
        const first = new PeerKey(home);
        const publicKey = await first.publicKey();
        expect(publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
        if (process.platform !== 'win32') {
            expect((await stat(join(home, PEER_KEY_FILE))).mode & 0o777).toBe(0o600);
        }
        expect(await new PeerKey(home).publicKey()).toBe(publicKey);
    });

    test('signs what the public half verifies', async () => {
        const key = new PeerKey(home);
        const signature = await key.sign('message');
        expect(verifySignature(await key.publicKey(), 'message', signature)).toBe(true);
        expect(verifySignature(await key.publicKey(), 'other', signature)).toBe(false);
    });

    test('two first calls at once make one key', async () => {
        const key = new PeerKey(home);
        const [one, two] = await Promise.all([key.publicKey(), key.publicKey()]);
        expect(one).toBe(two);
    });

    test('a file that will not read is replaced by a new key', async () => {
        await writeFile(join(home, PEER_KEY_FILE), '{ not json');
        expect(await new PeerKey(home).publicKey()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });
});
