import { describe, expect, test } from 'bun:test';
import type { HookResult } from '../sessions/manager.ts';
import { handleHookRequest } from './hook-receiver.ts';

const target = (result: HookResult) => {
    const calls: Array<{ kind: string; token: string; body: unknown }> = [];
    return {
        calls,
        async applyHook(kind: 'claude' | 'codex', token: string, body: unknown): Promise<HookResult> {
            calls.push({ kind, token, body });
            return result;
        }
    };
};

const post = (path: string, body: string, token?: string) =>
    new Request(`http://127.0.0.1${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body
    });

describe('handleHookRequest', () => {
    test('routes a valid POST to the session behind the token', async () => {
        const t = target('applied');
        const response = await handleHookRequest(post('/hooks/claude', '{"hook_event_name":"Stop"}', 'tok'), '/hooks/claude', t);
        expect(response.status).toBe(204);
        expect(t.calls).toEqual([{ kind: 'claude', token: 'tok', body: { hook_event_name: 'Stop' } }]);
    });

    test('rejects a missing token, an unknown token, an unknown agent and a body that is not JSON', async () => {
        expect((await handleHookRequest(post('/hooks/claude', '{}'), '/hooks/claude', target('applied'))).status).toBe(401);
        expect((await handleHookRequest(post('/hooks/claude', '{}', 'x'), '/hooks/claude', target('unknown-token'))).status).toBe(401);
        expect((await handleHookRequest(post('/hooks/gemini', '{}', 'x'), '/hooks/gemini', target('applied'))).status).toBe(404);
        expect((await handleHookRequest(post('/hooks/codex', 'nope', 'x'), '/hooks/codex', target('applied'))).status).toBe(400);
    });

    test('only POST', async () => {
        const response = await handleHookRequest(new Request('http://127.0.0.1/hooks/claude'), '/hooks/claude', target('applied'));
        expect(response.status).toBe(405);
    });
});
