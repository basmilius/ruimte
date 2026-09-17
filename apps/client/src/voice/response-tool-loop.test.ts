import { describe, expect, test } from 'bun:test';
import type { LiveEvent } from '@/voice/live-session';
import { ResponseToolLoop } from '@/voice/response-tool-loop';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('ResponseToolLoop', () => {
    test('executes a completed function call and continues after its response completes', async () => {
        const sent: LiveEvent[] = [];
        const calls: unknown[] = [];
        const loop = new ResponseToolLoop(
            (event) => sent.push(event),
            async (name, args) => {
                calls.push({ name, args });
                return { ok: true, message: 'Focused Chat Test' };
            }
        );

        loop.handle({
            type: 'response.event',
            delegation_id: 'delegation-1',
            event: {
                type: 'response.output_item.done',
                item: {
                    type: 'function_call',
                    call_id: 'call-1',
                    name: 'manage_views',
                    arguments: '{"action":"focus","view":"Chat Test","kind":null,"name":null,"url":null,"command":null}'
                }
            }
        });
        loop.handle({
            type: 'response.event',
            delegation_id: 'delegation-1',
            event: { type: 'response.completed' }
        });
        await flush();

        expect(calls).toEqual([
            {
                name: 'manage_views',
                args: '{"action":"focus","view":"Chat Test","kind":null,"name":null,"url":null,"command":null}'
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
    });

    test('does not run the same call twice', async () => {
        let executions = 0;
        const loop = new ResponseToolLoop(
            () => undefined,
            async () => {
                executions += 1;
                return { ok: true };
            }
        );
        const event = {
            type: 'response.event',
            delegation_id: 'delegation-1',
            event: {
                type: 'response.output_item.done',
                item: {
                    type: 'function_call',
                    call_id: 'call-1',
                    name: 'inspect_workspace',
                    arguments: '{}'
                }
            }
        };
        loop.handle(event);
        loop.handle(event);
        await flush();
        expect(executions).toBe(1);
    });

    test('completes every parallel call before requesting the dependent response', async () => {
        const sent: LiveEvent[] = [];
        const completed: string[] = [];
        const loop = new ResponseToolLoop(
            (event) => sent.push(event),
            async (_name, args) => {
                const title = String(JSON.parse(args).title);
                await Promise.resolve();
                completed.push(title);
                return { ok: true, node: title };
            }
        );

        for (const title of ['One', 'Two', 'Three', 'Four']) {
            loop.handle({
                type: 'response.event',
                delegation_id: 'delegation-notes',
                event: {
                    type: 'response.output_item.done',
                    item: {
                        type: 'function_call',
                        call_id: `call-${title}`,
                        name: 'manage_canvas',
                        arguments: JSON.stringify({ title })
                    }
                }
            });
        }
        loop.handle({
            type: 'response.event',
            delegation_id: 'delegation-notes',
            event: { type: 'response.completed' }
        });
        await flush();

        expect(completed).toEqual(['One', 'Two', 'Three', 'Four']);
        expect(sent.filter((event) => event.type === 'response.item.create')).toHaveLength(4);
        expect(sent.filter((event) => event.type === 'response.create')).toHaveLength(1);
    });
});
