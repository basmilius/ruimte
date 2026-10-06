import { describe, expect, test } from 'bun:test';
import { createClientActionRegistry, PERSON_ACTION_CALL, VOICE_ACTION_CALL } from './client-actions';
import type { DatabaseMachine } from './database-actions';
import { useDocument } from '@/state/document';
import { TransportError } from '@/transport/transport';

function registry(database: Partial<DatabaseMachine>) {
    return createClientActionRegistry(useDocument, { database });
}

describe('database.request', () => {
    test('hands the request to the machine as it stands and answers with its response', async () => {
        const asked: unknown[] = [];
        const actions = registry({
            transport: () =>
                ({
                    request: async (type: string, payload: unknown) => {
                        asked.push({ type, payload });
                        return { id: 'r1', ok: true, result: { schemas: [] } };
                    }
                }) as never
        });
        const request = { id: 'r1', method: 'schemas', params: { session: 's1' } };
        const result = await actions.execute('database.request', { request }, PERSON_ACTION_CALL);
        expect(result).toMatchObject({ status: 'completed', output: { response: { id: 'r1', ok: true } } });
        expect(asked).toEqual([{ type: 'database.request', payload: request }]);
    });

    test('is a person’s alone', async () => {
        const result = await registry({ transport: () => null }).execute('database.request', { request: {} }, VOICE_ACTION_CALL);
        expect(result).toMatchObject({ status: 'failed', error: { code: 'forbidden-action' } });
    });

    test('says so without a machine, and keeps the machine’s own code', async () => {
        expect(await registry({ transport: () => null }).execute('database.request', { request: {} }, PERSON_ACTION_CALL)).toMatchObject({
            status: 'failed',
            error: { code: 'offline' }
        });
        const refusing = registry({
            transport: () =>
                ({
                    request: async () => {
                        throw new TransportError('unknown-request', 'Unknown request');
                    }
                }) as never
        });
        expect(await refusing.execute('database.request', { request: {} }, PERSON_ACTION_CALL)).toMatchObject({
            status: 'failed',
            error: { code: 'unknown-request' }
        });
    });
});
