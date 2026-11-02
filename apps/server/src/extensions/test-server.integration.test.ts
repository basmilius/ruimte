import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestServer } from './test-server.ts';

const root = mkdtempSync(join(process.env.RUIMTE_INTEGRATION_FIXTURE_ROOT ?? tmpdir(), 'ruimte-test-server-'));

mkdirSync(join(root, 'server'));
writeFileSync(join(root, 'server', 'counter.ts'), 'let count = 0;\n\nexport function next(): number {\n    count += 1;\n\n    return count;\n}\n');
writeFileSync(
    join(root, 'server', 'index.ts'),
    `import { chats, defineServer, machine, storage } from '@ruimte/extension/server';
import { next } from './counter';

export default defineServer({
    async next() {
        return next();
    },
    async keep(value: string) {
        await storage.set('kept', value);
    },
    async start(input: object) {
        try {
            return await machine.run({ id: 'project-1' }, 'launch.start', input as { launch: string });
        } catch (e) {
            return \`\${(e as Error).name}: \${(e as Error).message}\`;
        }
    },
    async send() {
        const sent = await chats.send('chat-1', 'Hello');

        return { ok: sent.ok, hasValue: 'value' in sent, value: sent.ok ? String(sent.value) : null };
    }
});
`
);

afterAll(() => rmSync(root, { recursive: true, force: true }));

function serverOf(permissions: Record<string, string> = {}) {
    return createTestServer<{
        next(): Promise<number>;
        keep(value: string): Promise<void>;
        start(input: object): Promise<unknown>;
        send(): Promise<{ ok: boolean; hasValue: boolean; value: string | null }>;
    }>({
        entry: join(root, 'server', 'index.ts'),
        manifest: { id: 'acme.probe', permissions },
        answers: {
            'chats.send': () => undefined,
            'machine.run': { 'launch.start': ({ launch }) => ({ id: launch, name: launch }) }
        }
    });
}

describe('createTestServer', () => {
    test('loads every file of the project afresh, so a module of one test server keeps nothing of another', async () => {
        const first = await serverOf();

        expect(await first.call('next')).toEqual({ ok: true, value: 1 });
        expect(await first.call('next')).toEqual({ ok: true, value: 2 });
        expect(await (await serverOf()).call('next')).toEqual({ ok: true, value: 1 });
    });

    test('lets what a server loaded speak for that server, while a later one runs', async () => {
        const first = await serverOf();
        const second = await serverOf();

        await first.call('keep', 'first');
        await second.call('keep', 'second');

        expect(first.storage).toEqual({ kept: 'first' });
        expect(second.storage).toEqual({ kept: 'second' });
    });

    test('checks the input of a machine action as the machine does, and throws for one of the wrong shape', async () => {
        const server = await serverOf({ 'launches.run': 'Starts the app' });

        expect(await server.call('start', { launch: 'web' })).toEqual({ ok: true, value: { ok: true, value: { id: 'web', name: 'web' } } });
        expect(await server.call('start', {})).toEqual({ ok: true, value: expect.stringMatching(/^TypeError: launch\.start takes another input: /) });
        expect(server.logs).toEqual([expect.stringMatching(/^action answered invalid-input: launch\.start takes another input: /)]);
    });

    test('answers a call with nothing to answer with the key value there, set to undefined', async () => {
        const server = await serverOf({ 'chats.send': 'Says hello' });

        expect(await server.call('send')).toEqual({ ok: true, value: { ok: true, hasValue: true, value: 'undefined' } });
    });
});
