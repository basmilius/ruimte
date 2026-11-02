/*
 * What `server/` of an extension does, held the same way against `createTestServer` (`test/server.test.ts`) and the
 * `ExtensionHost` of the machine with a real process (`apps/server/src/extensions/contract.integration.test.ts`).
 * Each world runs `poc.contract`'s own `server/` with the permissions a scenario asks for, answers `chats.send`,
 * and answers `launch.start` with the launch it was given.
 */
import { describe, expect, test } from 'bun:test';
import type * as Server from '../../../packages/extension/server';

export const ID = 'poc.contract';

export interface ServerWorld {
    /* A method of `server/`, answered as the client reads it. */
    call(method: string, ...args: unknown[]): Promise<Server.Result<unknown>>;
    /* A machine event, as the machine hands it on. */
    fire(name: string, payload: object): void;
    /* An agent's call of a tool, by the id the extension gave it. */
    tool(id: string, input: object, caller: string): Promise<string>;
    logs(): Promise<string[]>;
    /* What `emit` said, as a client hears it. */
    emitted(): Promise<{ name: string; payload?: unknown }[]>;
}

export type OpenServerWorld = (permissions: Record<string, string>) => Promise<ServerWorld>;

const SENDS = { 'chats.send': 'Says hello' };

export function serverContract(open: OpenServerWorld): void {
    describe('the server contract', () => {
        test('hears a machine event only with its permission, and says why not in the log', async () => {
            const allowed = await open({ 'chats.read': 'Hears' });
            const refused = await open({});

            expect(await allowed.call('heard')).toEqual({ ok: true, value: [] });
            expect(await refused.call('heard')).toEqual({ ok: true, value: [] });

            allowed.fire('chat.event', { chatId: 'chat-1' });
            refused.fire('chat.event', { chatId: 'chat-1' });

            expect(await allowed.call('heard')).toEqual({ ok: true, value: ['chat-1'] });
            expect(await refused.call('heard')).toEqual({ ok: true, value: [] });
            expect(await refused.logs()).toContain('chat.event needs the permission chats.read in manifest.json');
        });

        test('reads no key it never wrote, also one every object has', async () => {
            const world = await open({});

            expect(await world.call('kept', 'constructor')).toEqual({ ok: true, value: null });
            expect(await world.call('kept', '__proto__')).toEqual({ ok: true, value: null });
            expect(await world.call('kept', 'toString')).toEqual({ ok: true, value: null });
        });

        test('goes on after its own code prints, also what reads as a message', async () => {
            const world = await open({});

            expect(await world.call('prints')).toEqual({ ok: true, value: 'printed' });
            expect(await world.call('loads')).toEqual({ ok: true, value: [1, 1] });
        });

        test('answers what its module awaits as it loads, and keeps what it stored then', async () => {
            const world = await open({});

            expect(await world.call('loads')).toEqual({ ok: true, value: [1, 1] });
        });

        test('answers an agent through its tool, and has no tool without agents.tools', async () => {
            const offered = await open({ 'agents.tools': 'Offers' });
            const hidden = await open({});

            expect(await offered.tool('echo', { text: 'Hi' }, 'chat-9')).toBe('Hi, for chat-9');
            await expect(hidden.tool('echo', { text: 'Hi' }, 'chat-9')).rejects.toThrow(`No tool ${ID}/echo. ruimte-context tool list says what there is`);
        });

        test('sends a chat at most 20 messages an hour, each with value undefined', async () => {
            const world = await open(SENDS);
            const sent: Server.Result<unknown>[] = [];

            for (let send = 0; send < 21; send++) {
                sent.push(await world.call('send', 'chat-1'));
            }

            expect(sent.slice(0, 20)).toEqual(Array.from({ length: 20 }, () => ({ ok: true, value: { ok: true, keys: ['ok', 'value'], value: 'undefined' } })));
            expect(sent[20]).toEqual({
                ok: true,
                value: { ok: false, error: { code: 'limit', message: `${ID} sent chat-1 20 messages this hour and has to wait` } }
            });
        });

        test('refuses what the manifest does not ask for, in the words of the machine', async () => {
            const world = await open({});

            expect(await world.call('send', 'chat-1')).toEqual({
                ok: true,
                value: { ok: false, error: { code: 'permission-denied', message: `${ID} did not ask for the permission chats.send in its manifest` } }
            });
        });

        test('says an event without a payload as one a client hears with none', async () => {
            const world = await open({});

            expect(await world.call('finish')).toEqual({ ok: true, value: null });
            expect(await world.emitted()).toStrictEqual([{ name: 'done' }, { name: 'counted', payload: { count: 1 } }]);
        });

        test("checks a machine action's input, and throws for one of the wrong shape", async () => {
            const world = await open({ 'launches.run': 'Starts' });

            expect(await world.call('start', { launch: 'web' })).toEqual({ ok: true, value: { ok: true, value: { id: 'web', name: 'web' } } });
            expect(await world.call('start', {})).toEqual({ ok: true, value: expect.stringMatching(/^TypeError: launch\.start takes another input: /) });
            expect(await world.call('missing')).toEqual({ ok: false, error: { code: 'not-found', message: 'No method missing' } });
        });
    });
}
