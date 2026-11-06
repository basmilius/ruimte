import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { checkedReply } from './peer-reply.ts';

describe('what another machine answered', () => {
    test('passes an answer that fits and drops the keys the answer does not name', () => {
        expect(checkedReply<object>('peer.taskStart', { cwd: '/work', branch: null, extra: 'left out' })).toEqual({ cwd: '/work', branch: null });
        expect(checkedReply<object>('peer.result', { status: 'open', result: null, bundle: null })).toEqual({ status: 'open', result: null, bundle: null });
    });

    test('drops the extra keys of a result and of the bundle inside it', () => {
        const reply = {
            status: 'done',
            hidden: 1,
            result: { text: 'ok', source: 'turn', at: 1, hidden: 2 },
            bundle: { bundleId: 'bundle-abcdef', sha256: 'a'.repeat(64), size: 3, commit: 'c0ffee', base: null, branch: 'ruimte/x', hidden: 3 }
        };
        const checked = checkedReply<Record<string, Record<string, unknown>>>('peer.result', reply);
        expect(Object.keys(checked).sort()).toEqual(['bundle', 'result', 'status']);
        expect(Object.keys(checked.result!).sort()).toEqual(['at', 'source', 'text']);
        expect(Object.keys(checked.bundle!)).not.toContain('hidden');
    });

    test('refuses an answer that is not one to the request', () => {
        expect(() => checkedReply('peer.result', { status: 'finished', result: 'text', bundle: null })).toThrow('not an answer to it');
        expect(() => checkedReply('peer.taskStart', 'ok')).toThrow('not an answer to it');
        expect(() => checkedReply('peer.bundleRead', { size: -1, offset: 0, data: 5 })).toThrow('not an answer to it');
    });

    test('refuses a request this machine has no answer for', () => {
        expect(() => checkedReply('peer.nothing', {})).toThrow('does not know');
    });

    test('drops the extra keys at every depth, also where a schema in the chain keeps them', () => {
        const schemas = {
            'peer.result': {
                result: z.looseObject({
                    status: z.string(),
                    result: z.looseObject({ text: z.string(), at: z.number() }).nullable(),
                    parts: z.array(z.looseObject({ id: z.string() })),
                    either: z.union([z.looseObject({ kind: z.literal('a') }), z.looseObject({ kind: z.literal('b'), size: z.number() })]),
                    byName: z.record(z.string(), z.looseObject({ id: z.string() })),
                    maybe: z.looseObject({ id: z.string() }).optional()
                })
            }
        };
        const answer = {
            status: 'done',
            hidden: 1,
            result: { text: 'ok', at: 1, hidden: 2 },
            parts: [{ id: 'a', hidden: 3 }],
            either: { kind: 'b', size: 2, hidden: 4 },
            byName: { one: { id: 'x', hidden: 5 } },
            maybe: { id: 'y', hidden: 6 }
        };
        expect(checkedReply<object>('peer.result', answer, schemas)).toEqual({
            status: 'done',
            result: { text: 'ok', at: 1 },
            parts: [{ id: 'a' }],
            either: { kind: 'b', size: 2 },
            byName: { one: { id: 'x' } },
            maybe: { id: 'y' }
        });
    });

    test('keeps what a schema names through a catchall of its own', () => {
        const schemas = { 'peer.result': { result: z.object({ id: z.string() }).catchall(z.number()) } };
        expect(checkedReply<object>('peer.result', { id: 'a', count: 2 }, schemas)).toEqual({ id: 'a', count: 2 });
    });
});
