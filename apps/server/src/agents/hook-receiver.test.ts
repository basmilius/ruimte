import { describe, expect, test } from 'bun:test';
import type { HookResult } from '../sessions/manager.ts';
import { handleHookRequest } from './hook-receiver.ts';

const target = (result: HookResult) => {
    const calls: Array<{ kind: string; token: string; body: unknown }> = [];
    return {
        calls,
        knows: () => result !== 'unknown-token',
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
        expect((await handleHookRequest(post('/hooks/nope', '{}', 'x'), '/hooks/nope', target('applied'))).status).toBe(404);
        expect((await handleHookRequest(post('/hooks/codex', 'nope', 'x'), '/hooks/codex', target('applied'))).status).toBe(400);
    });

    test('turns away a made-up token before it reads a byte of a chunked body', async () => {
        let pulls = 0;
        const body = new ReadableStream<Uint8Array>(
            {
                pull(controller) {
                    pulls++;
                    controller.enqueue(new Uint8Array(1024 * 1024));
                    if (pulls === 4) {
                        controller.close();
                    }
                }
            },
            { highWaterMark: 0 }
        );
        const request = new Request('http://127.0.0.1/hooks/claude', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: 'Bearer made-up' },
            body
        });
        const unknown = target('unknown-token');

        expect(request.headers.get('content-length')).toBeNull();
        expect((await handleHookRequest(request, '/hooks/claude', unknown)).status).toBe(401);
        expect(pulls).toBe(0);
        expect(request.bodyUsed).toBe(false);
        expect(unknown.calls).toEqual([]);
    });

    test('turns away a CLI whose hooks the daemon has no normalizer for', async () => {
        const gemini = target('applied');
        expect((await handleHookRequest(post('/hooks/gemini', '{}', 'x'), '/hooks/gemini', gemini)).status).toBe(404);
        expect((await handleHookRequest(post('/hooks/copilot', '{}', 'x'), '/hooks/copilot', gemini)).status).toBe(404);
        expect(gemini.calls).toEqual([]);
    });

    test('answers a Claude prompt hook with the context hint as additionalContext', async () => {
        const hint = (token: string) => (token === 'tok' ? 'Ruimte: linked context is available' : null);
        const body = '{"hook_event_name":"UserPromptSubmit","session_id":"s"}';
        const response = await handleHookRequest(post('/hooks/claude', body, 'tok'), '/hooks/claude', target('applied'), hint);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'Ruimte: linked context is available' }
        });
        const start = await handleHookRequest(post('/hooks/claude', '{"hook_event_name":"SessionStart"}', 'tok'), '/hooks/claude', target('applied'), hint);
        expect(((await start.json()) as { hookSpecificOutput: { hookEventName: string } }).hookSpecificOutput.hookEventName).toBe('SessionStart');
    });

    test('hands the hint callback the event it answers', async () => {
        const seen: string[] = [];
        const hint = (_token: string, event: string) => {
            seen.push(event);
            return event === 'SessionStart' ? 'verbs' : null;
        };
        const start = await handleHookRequest(post('/hooks/claude', '{"hook_event_name":"SessionStart"}', 'tok'), '/hooks/claude', target('applied'), hint);
        expect(await start.json()).toEqual({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'verbs' } });
        const prompt = await handleHookRequest(
            post('/hooks/claude', '{"hook_event_name":"UserPromptSubmit"}', 'tok'),
            '/hooks/claude',
            target('applied'),
            hint
        );
        expect(prompt.status).toBe(204);
        expect(seen).toEqual(['SessionStart', 'UserPromptSubmit']);
    });

    test('stays empty without links and on other events', async () => {
        const hint = () => 'hint';
        const none = () => null;
        const prompt = '{"hook_event_name":"UserPromptSubmit"}';
        expect((await handleHookRequest(post('/hooks/claude', prompt, 'tok'), '/hooks/claude', target('applied'), none)).status).toBe(204);
        expect((await handleHookRequest(post('/hooks/claude', prompt, 'tok'), '/hooks/claude', target('applied'))).status).toBe(204);
        expect((await handleHookRequest(post('/hooks/claude', '{"hook_event_name":"Stop"}', 'tok'), '/hooks/claude', target('applied'), hint)).status).toBe(
            204
        );
    });

    test('answers a Codex prompt hook the way it answers Claude Code, and names the kind', async () => {
        const kinds: string[] = [];
        const hint = (_token: string, event: string, kind: string) => {
            kinds.push(kind);
            return `${kind} ${event}`;
        };
        const prompt = await handleHookRequest(post('/hooks/codex', '{"hook_event_name":"UserPromptSubmit"}', 'tok'), '/hooks/codex', target('applied'), hint);
        expect(await prompt.json()).toEqual({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'codex UserPromptSubmit' } });
        const start = await handleHookRequest(post('/hooks/codex', '{"hook_event_name":"SessionStart"}', 'tok'), '/hooks/codex', target('applied'), hint);
        expect(await start.json()).toEqual({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'codex SessionStart' } });
        expect((await handleHookRequest(post('/hooks/codex', '{"hook_event_name":"Stop"}', 'tok'), '/hooks/codex', target('applied'), hint)).status).toBe(204);
        expect(kinds).toEqual(['codex', 'codex']);
    });

    test('only POST', async () => {
        const response = await handleHookRequest(new Request('http://127.0.0.1/hooks/claude'), '/hooks/claude', target('applied'));
        expect(response.status).toBe(405);
    });

    describe('a permission request', () => {
        const ask = '{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"rm -rf build"}}';

        test('carries the decision back as the CLI spells it', async () => {
            const allow = await handleHookRequest(post('/hooks/claude', ask, 'tok'), '/hooks/claude', target('applied'), undefined, async () => ({
                behavior: 'allow' as const
            }));
            expect(allow.status).toBe(200);
            expect(await allow.json()).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });

            const deny = await handleHookRequest(post('/hooks/claude', ask, 'tok'), '/hooks/claude', target('applied'), undefined, async () => ({
                behavior: 'deny' as const,
                message: 'no'
            }));
            expect(await deny.json()).toEqual({
                hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'no' } }
            });
        });

        test('carries the rule the person chose to remember', async () => {
            const rule = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm:*' }], behavior: 'allow', destination: 'localSettings' };
            const response = await handleHookRequest(post('/hooks/claude', ask, 'tok'), '/hooks/claude', target('applied'), undefined, async () => ({
                behavior: 'allow' as const,
                updatedPermissions: [rule]
            }));
            expect(await response.json()).toEqual({
                hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedPermissions: [rule] } }
            });
        });

        test('says nothing when nobody answered, so the CLI keeps its own prompt', async () => {
            const response = await handleHookRequest(post('/hooks/claude', ask, 'tok'), '/hooks/claude', target('applied'), undefined, async () => null);
            expect(response.status).toBe(204);
            expect(await response.text()).toBe('');
        });

        test('is not held for a token the daemon does not know', async () => {
            let held = false;
            const response = await handleHookRequest(post('/hooks/claude', ask, 'tok'), '/hooks/claude', target('unknown-token'), undefined, async () => {
                held = true;
                return { behavior: 'allow' as const };
            });
            expect(response.status).toBe(401);
            expect(held).toBe(false);
        });

        test('leaves every other event alone', async () => {
            const events: string[] = [];
            const hold = async (_token: string, body: unknown) => {
                events.push((body as { hook_event_name: string }).hook_event_name);
                return { behavior: 'allow' as const };
            };
            expect(
                (await handleHookRequest(post('/hooks/claude', '{"hook_event_name":"PreToolUse"}', 'tok'), '/hooks/claude', target('applied'), undefined, hold))
                    .status
            ).toBe(204);
            expect(events).toEqual([]);
        });
    });
});
