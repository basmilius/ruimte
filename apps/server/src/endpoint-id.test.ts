import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifySignature } from './auth/keys.ts';
import { readOrCreateEndpointIdentity } from './endpoint-id.ts';

let home: string;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-endpoint-id-'));
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('readOrCreateEndpointIdentity', () => {
    test('mints an id and a key pair once and answers with the same ones after that', async () => {
        const first = await readOrCreateEndpointIdentity(home);
        expect(first.id.length).toBeGreaterThan(8);
        const again = await readOrCreateEndpointIdentity(home);
        expect(again.id).toBe(first.id);
        expect(again.publicKey).toBe(first.publicKey);
        expect(verifySignature(first.publicKey, 'hello', again.sign('hello'))).toBe(true);

        const written = JSON.parse(await readFile(join(home, 'endpoint.json'), 'utf8')) as { version: number; id: string; privateKey: string };
        expect(written.version).toBe(1);
        expect(written.id).toBe(first.id);
        expect(written.privateKey).toContain('PRIVATE KEY');
    });

    test('a home from before the key pair keeps its id and only gains the key', async () => {
        await writeFile(join(home, 'endpoint.json'), JSON.stringify({ version: 1, id: 'minted-earlier' }));
        const identity = await readOrCreateEndpointIdentity(home);
        expect(identity.id).toBe('minted-earlier');
        expect(verifySignature(identity.publicKey, 'x', identity.sign('x'))).toBe(true);
        expect((await readOrCreateEndpointIdentity(home)).publicKey).toBe(identity.publicKey);
    });

    test('two machines sign with two keys', async () => {
        const other = await mkdtemp(join(tmpdir(), 'ruimte-endpoint-id-'));
        try {
            const mine = await readOrCreateEndpointIdentity(home);
            const theirs = await readOrCreateEndpointIdentity(other);
            expect(verifySignature(theirs.publicKey, 'x', mine.sign('x'))).toBe(false);
        } finally {
            await rm(other, { recursive: true, force: true });
        }
    });

    test('mints a new id in a home that has none, so two homes are two machines', async () => {
        const other = await mkdtemp(join(tmpdir(), 'ruimte-endpoint-id-'));
        try {
            expect((await readOrCreateEndpointIdentity(other)).id).not.toBe((await readOrCreateEndpointIdentity(home)).id);
        } finally {
            await rm(other, { recursive: true, force: true });
        }
    });

    test('a machine nobody has named answers to the name it was started with', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
        expect(identity.label).toBe('the-hostname');
        expect(identity.nameSource).toBe('default');
        expect(identity.icon).toBeNull();
    });

    test('a name and an icon go into the file and come back after a restart', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
        await identity.setIdentity('Studio', { kind: 'lucide', value: 'server' });
        expect(identity.label).toBe('Studio');
        expect(identity.nameSource).toBe('chosen');

        const written = JSON.parse(await readFile(join(home, 'endpoint.json'), 'utf8')) as { version: number; name: string; privateKey: string };
        // Still version 1: an older daemon reading this file has to keep the id rather than mint one.
        expect(written.version).toBe(1);
        expect(written.name).toBe('Studio');
        // The key pair is written back with it, or the machine would have to pair again.
        expect(written.privateKey).toContain('PRIVATE KEY');

        const restarted = await readOrCreateEndpointIdentity(home, 'the-hostname');
        expect(restarted.id).toBe(identity.id);
        expect(restarted.label).toBe('Studio');
        expect(restarted.icon).toEqual({ kind: 'lucide', value: 'server' });
    });

    test('a name that was typed in a client wins over the one the daemon was started with', async () => {
        await (await readOrCreateEndpointIdentity(home, 'from-the-flag')).setIdentity('Typed here', null);
        // What `--label` or `RUIMTE_LABEL` says on the next start; the person's choice outlives it.
        expect((await readOrCreateEndpointIdentity(home, 'from-the-flag')).label).toBe('Typed here');
    });

    test('clearing the name hands the machine back to the one it starts with', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
        await identity.setIdentity('Studio', { kind: 'emoji', value: '\u{1F5A5}\u{FE0F}' });
        await identity.setIdentity(null, null);
        expect(identity.label).toBe('the-hostname');
        expect(identity.nameSource).toBe('default');

        const written = JSON.parse(await readFile(join(home, 'endpoint.json'), 'utf8')) as Record<string, unknown>;
        expect(written.name).toBeUndefined();
        expect(written.icon).toBeUndefined();
    });

    test('every connected client hears the new name, and one that left hears nothing', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
        const first: unknown[] = [];
        const second: unknown[] = [];
        identity.subscribe('c1', (event) => first.push(event));
        const unsubscribe = identity.subscribe('c2', (event) => second.push(event));

        await identity.setIdentity('Studio', null);
        expect(first).toEqual([
            {
                event: 'endpoint.changed',
                payload: { id: identity.id, label: 'Studio', nameSource: 'chosen', icon: null, agentsDeleteAnyView: false, refuseStatements: false }
            }
        ]);
        expect(second).toHaveLength(1);

        unsubscribe();
        await identity.setIdentity('Studio again', null);
        expect(first).toHaveLength(2);
        expect(second).toHaveLength(1);
    });

    test('what an agent may delete is off on a fresh machine and survives a restart', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
        expect(identity.agentsDeleteAnyView).toBe(false);

        await identity.setIdentity('Studio', null, { agentsDeleteAnyView: true });
        expect(identity.agentsDeleteAnyView).toBe(true);
        expect((await readOrCreateEndpointIdentity(home, 'the-hostname')).agentsDeleteAnyView).toBe(true);

        // Naming the machine is a different control, so it leaves this one where it stands.
        await identity.setIdentity('Studio again', null);
        expect(identity.agentsDeleteAnyView).toBe(true);

        await identity.setIdentity('Studio again', null, { agentsDeleteAnyView: false });
        const written = JSON.parse(await readFile(join(home, 'endpoint.json'), 'utf8')) as Record<string, unknown>;
        expect(written.agentsDeleteAnyView).toBeUndefined();
    });

    test('a name or an icon that will not read is dropped, and the machine keeps its id', async () => {
        const identity = await readOrCreateEndpointIdentity(home, 'the-hostname');
        const written = JSON.parse(await readFile(join(home, 'endpoint.json'), 'utf8')) as Record<string, unknown>;
        await writeFile(join(home, 'endpoint.json'), JSON.stringify({ ...written, name: '', icon: { kind: 'nonsense', value: 'x' } }));

        const read = await readOrCreateEndpointIdentity(home, 'the-hostname');
        expect(read.id).toBe(identity.id);
        expect(read.publicKey).toBe(identity.publicKey);
        expect(read.label).toBe('the-hostname');
        expect(read.icon).toBeNull();
    });

    test('replaces a file that will not parse instead of failing to start', async () => {
        await writeFile(join(home, 'endpoint.json'), '{ not json');
        const minted = await readOrCreateEndpointIdentity(home);
        expect(minted.id.length).toBeGreaterThan(8);
        expect((await readOrCreateEndpointIdentity(home)).id).toBe(minted.id);
    });

    test('creates the home directory when the daemon has never written there', async () => {
        const fresh = join(home, 'nested', 'home');
        const minted = await readOrCreateEndpointIdentity(fresh);
        expect(await readFile(join(fresh, 'endpoint.json'), 'utf8')).toContain(minted.id);
    });
});
