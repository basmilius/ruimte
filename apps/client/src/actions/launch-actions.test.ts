import { describe, expect, test } from 'bun:test';
import { ActionRegistry } from '@ruimte/actions';
import type { LaunchConfigEntry } from '@ruimte/contracts';
import { PERSON_ACTION_CALL } from '@/action-port/perform';
import { TransportError, type Transport } from '@/transport-api/transport';
import { VOICE_ACTION_CALL } from './client-actions';
import { launchActions } from './launch-actions';

const web = { id: 'web', name: 'Web', kind: 'service', command: 'bun dev', shared: true } as unknown as LaunchConfigEntry;

function fake(answer: (payload: unknown) => unknown) {
    const sent: { type: string; payload: unknown }[] = [];
    const transport = {
        request: async (type: string, payload: unknown) => {
            sent.push({ type, payload });
            return answer(payload);
        }
    } as unknown as Transport;
    return { registry: new ActionRegistry<void>(launchActions({ transport: () => transport })), sent };
}

describe('launch actions', () => {
    test('a person saves the launches against the rev they were read at', async () => {
        const { registry, sent } = fake(() => ({ rev: 4 }));
        const input = { projectId: 'atlas', baseRev: 3, launches: [web], imported: ['web'] };
        expect(await registry.execute('launch.save', input, PERSON_ACTION_CALL)).toMatchObject({ status: 'completed', output: { rev: 4 } });
        expect(sent).toEqual([{ type: 'launches.save', payload: input }]);
    });

    test('a save that moved on refuses with the machine’s own code', async () => {
        const { registry } = fake(() => {
            throw new TransportError('rev-conflict', 'The launches moved on.');
        });
        expect(await registry.execute('launch.save', { projectId: 'atlas', baseRev: 1, launches: [], imported: [] }, PERSON_ACTION_CALL)).toMatchObject({
            error: { code: 'rev-conflict' }
        });
    });

    test('nobody but a person saves, since a save approves', async () => {
        const { registry, sent } = fake(() => ({ rev: 2 }));
        expect(await registry.execute('launch.save', { projectId: 'atlas', baseRev: 1, launches: [web], imported: [] }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'forbidden-action' }
        });
        expect(sent).toEqual([]);
    });
});
