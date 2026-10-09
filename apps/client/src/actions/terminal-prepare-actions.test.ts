import { describe, expect, test } from 'bun:test';
import { ActionRegistry } from '@ruimte/actions';
import { terminalPrepareActions } from './terminal-prepare-actions';
import { TransportError, type Transport } from '@/transport/transport';

function fixture() {
    const calls: unknown[] = [];
    const transport: Transport = {
        status: 'open',
        request: async (type, payload) => {
            calls.push({ type, payload });
            return (
                type === 'session.prepare'
                    ? { sessionId: 'terminal' }
                    : { machineId: 'owner', machine: 'Remote', command: 'echo ok', cwd: '/work', targets: [] }
            ) as never;
        },
        on: () => () => {},
        subscribeStatus: () => () => {}
    };
    let id: string | null = 'owner';
    const registry = new ActionRegistry(
        terminalPrepareActions({
            machineId: () => id,
            transport: (endpointId) => (endpointId === 'remote' ? transport : null)
        })
    );
    return {
        registry,
        calls,
        transport,
        disconnect: () => {
            id = null;
        }
    };
}
const input = { endpointId: 'remote', machineId: 'owner', chatId: 'chat', itemId: 'reply', language: 'sh', code: 'echo ok' };
const person = { actor: { kind: 'person' as const, id: 'person' }, context: undefined };

describe('machine-bound terminal preparation actions', () => {
    test('only asks the chat endpoint and never falls back to local', async () => {
        const { registry, calls } = fixture();
        expect((await registry.execute('terminal.preparePreview', input, person)).status).toBe('completed');
        expect(calls).toEqual([
            { type: 'session.preparePreview', payload: { machineId: 'owner', chatId: 'chat', itemId: 'reply', language: 'sh', code: 'echo ok' } }
        ]);
        expect((await registry.execute('terminal.preparePreview', { ...input, endpointId: 'local' }, person)).status).toBe('failed');
        expect(calls).toHaveLength(1);
    });
    test('disconnects and identity changes refuse without a request', async () => {
        const { registry, calls, disconnect } = fixture();
        disconnect();
        expect((await registry.execute('terminal.prepare', { endpointId: 'remote', machineId: 'owner', token: 'preview' }, person)).status).toBe('failed');
        expect(calls).toEqual([]);
    });
    for (const kind of ['agent', 'automation', 'voice'] as const) {
        test(`${kind} cannot prepare terminal input or request previews`, async () => {
            const { registry, calls } = fixture();
            const actor = { actor: { kind, id: 'actor' }, context: undefined };
            expect((await registry.execute('terminal.preparePreview', input, actor)).status).toBe('failed');
            expect((await registry.execute('terminal.prepare', { endpointId: 'remote', machineId: 'owner', token: 'preview' }, actor)).status).toBe('failed');
            expect(calls).toEqual([]);
        });
    }
});

for (const [transportCode, expected] of [
    ['terminal-editor-refused', 'terminal-editor-refused'],
    ['terminal-prepare-refused', 'terminal-prepare-refused'],
    ['terminal-prepare-unconfirmed', 'terminal-prepare-unconfirmed'],
    ['disconnected', 'terminal-prepare-unconfirmed'],
    ['timeout', 'terminal-prepare-unconfirmed'],
    ['bad-reply', 'terminal-prepare-unconfirmed']
]) {
    test(`prepare preserves ${transportCode} as ${expected} without a retry`, async () => {
        const { registry, transport } = fixture();
        let attempts = 0;
        transport.request = async () => {
            attempts++;
            throw new TransportError(transportCode!, 'test error');
        };
        const result = await registry.execute('terminal.prepare', { endpointId: 'remote', machineId: 'owner', token: 'preview' }, person);
        expect(result).toMatchObject({ status: 'failed', error: { code: expected } });
        expect(attempts).toBe(1);
    });
}
