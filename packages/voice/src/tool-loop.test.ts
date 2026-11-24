import { describe, expect, test } from 'bun:test';
import { VOICE_CONTROL_TOOL, VOICE_TOOL_ACTIONS } from '@ruimte/actions';
import type { LiveEvent } from './live-event.ts';
import { VoiceToolLoop, type ToolLoopObserver } from './tool-loop.ts';

const toolNames = new Set<string>([...VOICE_TOOL_ACTIONS.keys(), VOICE_CONTROL_TOOL]);

function functionCall(delegationId: string, callId: string, name: string, args: string): LiveEvent {
    return {
        type: 'response.event',
        delegation_id: delegationId,
        event: { type: 'response.output_item.done', item: { type: 'function_call', call_id: callId, name, arguments: args } }
    };
}

function responseCompleted(delegationId: string): LiveEvent {
    return { type: 'response.event', delegation_id: delegationId, event: { type: 'response.completed' } };
}

describe('VoiceToolLoop', () => {
    test('a call that outlives a reset sends nothing to the next session', async () => {
        const sent: LiveEvent[] = [];
        const result = Promise.withResolvers<Record<string, unknown>>();
        const finished = Promise.withResolvers<void>();
        const loop = new VoiceToolLoop(
            (event) => sent.push(event),
            () => result.promise,
            { toolNames, observer: { responseEvent() {}, responseRequested() {}, callStarted() {}, callFinished: () => finished.resolve() } }
        );

        loop.handle(functionCall('d1', 'c1', 'inspect_workspace', '{}'));
        loop.reset();
        result.resolve({ ok: true });
        await finished.promise;
        await Promise.resolve();

        expect(sent).toEqual([]);
    });

    test('executes a completed function call and continues after its response completes', async () => {
        const sent: LiveEvent[] = [];
        const calls: unknown[] = [];
        const continued = Promise.withResolvers<void>();
        const loop = new VoiceToolLoop(
            (event) => {
                sent.push(event);
                if (event.type === 'response.create') {
                    continued.resolve();
                }
            },
            async (name, args, callId) => {
                calls.push({ name, args, callId });
                return { ok: true, message: 'Focused Chat Test' };
            },
            { toolNames }
        );

        loop.handle(functionCall('delegation-1', 'call-1', 'manage_views', '{"action":"view.focus","viewId":"chat-test"}'));
        loop.handle(responseCompleted('delegation-1'));
        await continued.promise;

        expect(calls).toEqual([
            {
                name: 'manage_views',
                args: '{"action":"view.focus","viewId":"chat-test"}',
                callId: 'call-1'
            }
        ]);
        expect(sent[0]).toMatchObject({
            type: 'response.item.create',
            item: {
                type: 'function_call_output',
                call_id: 'call-1',
                output: expect.stringContaining('Focused Chat Test')
            }
        });
        expect(sent[1]).toMatchObject({ type: 'response.create' });
        expect(sent).toHaveLength(2);
    });

    test('does not run the same call twice', async () => {
        let executions = 0;
        const result = Promise.withResolvers<Record<string, unknown>>();
        const output = Promise.withResolvers<void>();
        const sent: LiveEvent[] = [];
        const loop = new VoiceToolLoop(
            (event) => {
                sent.push(event);
                output.resolve();
            },
            async () => {
                executions += 1;
                return result.promise;
            },
            { toolNames }
        );
        const event = functionCall('delegation-1', 'call-1', 'inspect_workspace', '{}');
        loop.handle(event);
        loop.handle(event);
        expect(executions).toBe(1);
        expect(sent).toEqual([]);
        result.resolve({ ok: true });
        await output.promise;
        loop.handle(event);
        expect(executions).toBe(1);
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ type: 'response.item.create', item: { call_id: 'call-1', output: '{"ok":true}' } });
    });

    test('completes every parallel call before requesting the dependent response', async () => {
        const sent: LiveEvent[] = [];
        const completed: string[] = [];
        const titles = ['One', 'Two', 'Three', 'Four'];
        const results = titles.map(() => Promise.withResolvers<void>());
        const outputs = titles.map(() => Promise.withResolvers<void>());
        const continued = Promise.withResolvers<void>();
        const loop = new VoiceToolLoop(
            (event) => {
                sent.push(event);
                if (event.type === 'response.create') {
                    continued.resolve();
                } else if (event.type === 'response.item.create') {
                    const item = event.item as { call_id: string };
                    outputs[titles.findIndex((title) => item.call_id === `call-${title}`)]!.resolve();
                }
            },
            async (_name, args) => {
                const title = String(JSON.parse(args).title);
                await results[titles.indexOf(title)]!.promise;
                completed.push(title);
                return { ok: true, node: title };
            },
            { toolNames }
        );

        for (const title of titles) {
            loop.handle(functionCall('delegation-notes', `call-${title}`, 'manage_canvas', JSON.stringify({ title })));
        }
        loop.handle(responseCompleted('delegation-notes'));
        expect(sent).toEqual([]);
        for (const index of [2, 0, 1]) {
            results[index]!.resolve();
            await outputs[index]!.promise;
        }
        expect(completed).toEqual(['Three', 'One', 'Two']);
        expect(sent.map((event) => event.type)).toEqual(['response.item.create', 'response.item.create', 'response.item.create']);
        results[3]!.resolve();
        await continued.promise;

        expect(completed).toEqual(['Three', 'One', 'Two', 'Four']);
        expect(sent.filter((event) => event.type === 'response.item.create')).toHaveLength(4);
        expect(sent.filter((event) => event.type === 'response.create')).toHaveLength(1);
        expect(sent.at(-1)?.type).toBe('response.create');
    });

    test('tells its observer what it saw, ran and asked for, in that order', async () => {
        const seen: string[] = [];
        const continued = Promise.withResolvers<void>();
        const observer: ToolLoopObserver = {
            responseEvent: (delegationId, type) => seen.push(`event ${delegationId} ${type}`),
            responseRequested: (delegationId) => {
                seen.push(`requested ${delegationId}`);
                continued.resolve();
            },
            callStarted: (delegationId, callId, tool) => seen.push(`started ${delegationId} ${callId} ${tool}`),
            callFinished: (callId, output) => seen.push(`finished ${callId} ${String(output.code)}`)
        };
        const loop = new VoiceToolLoop(
            () => undefined,
            async () => {
                throw new Error('The voice session or project changed.');
            },
            { toolNames, observer }
        );

        loop.handle(functionCall('d1', 'c1', 'inspect_workspace', '{}'));
        loop.handle(responseCompleted('d1'));
        await continued.promise;

        expect(seen).toEqual([
            'event d1 response.output_item.done',
            'started d1 c1 inspect_workspace',
            'event d1 response.completed',
            'finished c1 tool-error',
            'requested d1'
        ]);
    });
});
