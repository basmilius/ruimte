/*
 * What the client of an extension does, held the same way against the test host (`test/client.dom.test.ts`) and the
 * client host of Ruimte (`apps/client/src/extensions/host/contract.dom.test.tsx`), so the two cannot drift apart.
 * Each world seeds `SEED` and gives the API of `poc.contract` with the permissions a scenario asks for.
 */
import { describe, expect, test } from 'bun:test';
import { EXTENSION_CLIENT_PERMISSIONS } from '@ruimte/contracts/extension-client';
import type * as Client from '../../../packages/extension/client';

type Result<Value> = Client.Result<Value>;

export const NAME = 'POC contract';

export const SEED = {
    project: { id: 'project-a', name: 'A', folder: '/work/a' },
    view: { id: 'view-1', kind: 'canvas', name: 'Plan' },
    node: { id: 'note-1', kind: 'note', title: 'First' },
    machine: { id: 'local' }
} as const;

export interface ContractScreen {
    text(): string;
    click(label: string): Promise<void>;
    until(check: () => unknown): Promise<void>;
}

export interface ClientWorld {
    api: typeof Client;
    /* React of the world's own, so a component of a scenario draws with the copy that draws it. */
    createElement(type: unknown, props?: object | null, ...children: unknown[]): unknown;
    render(component: () => unknown): Promise<ContractScreen>;
    /* The title an action shows with at a place, or null where it does not show. */
    slot(action: string, place: Client.SlotName, extra: object): string | null;
    /* Presses an action at a place as a person would: a throw is `failed`, which a person is shown. */
    run(action: string, place: Client.SlotName, extra: object): Promise<Result<void>>;
    /* Selects nodes as a person does. */
    select(ids: string[]): void;
    notes(): { title: string; text: string }[];
    links(): { from: string; to: string }[];
    /* What a person was shown of a failed action: its title and why. */
    failures(): { text: string; detail: string }[];
}

export type OpenClientWorld = (permissions: Record<string, string>) => Promise<ClientWorld>;

const ALL = { 'canvas.write': 'Writes' };
const REF = { id: 'note-1' };

/* An argument for every call of the permission table that is no hook, so a call it gains is held here too. */
const CALLS: Readonly<Record<string, (api: typeof Client) => unknown>> = {
    'files.readText': (api) => api.files.readText('notes.md'),
    'files.write': (api) => api.files.write('notes.md', 'Hi'),
    'files.list': (api) => api.files.list('.'),
    'files.watch': (api) => api.files.watch('notes.md', () => undefined),
    'git.status': (api) => api.git.status(),
    'git.diff': (api) => api.git.diff({ path: 'notes.md' }),
    'git.log': (api) => api.git.log(),
    'terminals.read': (api) => api.terminals.read(REF),
    'terminals.open': (api) => api.terminals.open(),
    'database.connections': (api) => api.database.connections(),
    'database.query': (api) => api.database.query('main', 'select 1'),
    'chats.list': (api) => api.chats.list(),
    'chats.read': (api) => api.chats.read('chat-1'),
    'chats.send': (api) => api.chats.send('chat-1', 'Hi'),
    'views.createCanvas': (api) => api.views.createCanvas('New'),
    'views.rename': (api) => api.views.rename({ id: 'view-1' }, 'New'),
    'context.read': (api) => api.context.read({ nodes: [REF] }),
    'agents.run': (api) => api.agents.run({ prompt: 'Hi' }),
    'agents.stream': async (api) => {
        for await (const piece of api.agents.stream({ prompt: 'Hi' })) {
            return piece;
        }

        return null;
    },
    'agents.start': (api) => api.agents.start({ prompt: 'Hi' }),
    'canvas.createNote': (api) => api.canvas.createNote({ text: 'Hi' }),
    'canvas.createFile': (api) => api.canvas.createFile('notes.md'),
    'canvas.createBrowser': (api) => api.canvas.createBrowser('https://ruimte.app'),
    'canvas.createNode': (api) => api.canvas.createNode('probe'),
    'canvas.update': (api) => api.canvas.update(REF, { title: 'New' }),
    'canvas.writeNote': (api) => api.canvas.writeNote(REF, 'Hi'),
    'canvas.arrange': (api) => api.canvas.arrange([REF], 'row'),
    'canvas.remove': (api) => api.canvas.remove([REF]),
    'canvas.group': (api) => api.canvas.group([REF]),
    'canvas.link': (api) => api.canvas.link(REF, REF),
    'canvas.unlink': (api) => api.canvas.unlink(REF, REF),
    'launches.list': (api) => api.launches.list(),
    'launches.read': (api) => api.launches.read({ launch: 'web' }),
    'launches.start': (api) => api.launches.start({ launch: 'web' }),
    'launches.restart': (api) => api.launches.restart({ launch: 'web' }),
    'launches.stop': (api) => api.launches.stop({ launch: 'web' }),
    'routines.list': (api) => api.routines.list(),
    'routines.run': (api) => api.routines.run({ routine: 'nightly' }),
    'routines.pause': (api) => api.routines.pause({ routine: 'nightly' }),
    'routines.resume': (api) => api.routines.resume({ routine: 'nightly' }),
    'artifacts.list': (api) => api.artifacts.list(),
    'artifacts.read': (api) => api.artifacts.read({ artifact: 'report' }),
    'artifacts.publish': (api) => api.artifacts.publish({ upload: 'u', files: [{ name: 'a.txt', size: 1 }], requestId: 'r' }),
    'browser.inspect': (api) => api.browser.inspect({ node: REF }),
    'browser.navigate': (api) => api.browser.navigate({ node: REF, url: 'https://ruimte.app' }),
    'browser.back': (api) => api.browser.back({ node: REF }),
    'browser.forward': (api) => api.browser.forward({ node: REF }),
    'browser.reload': (api) => api.browser.reload({ node: REF }),
    'browser.screenshot': (api) => api.browser.screenshot({ node: REF }),
    'devices.list': (api) => api.devices.list(),
    'devices.inspect': (api) => api.devices.inspect({ node: REF }),
    'devices.screenshot': (api) => api.devices.screenshot({ node: REF }),
    'devices.tap': (api) => api.devices.tap({ node: REF, x: 1, y: 1 }),
    'devices.launch': (api) => api.devices.launch({ node: REF, app: 'app.ruimte' })
};
const HOOKS = new Set(['useAgents', 'useUsageLimits']);

export function clientContract(open: OpenClientWorld): void {
    describe('the client contract', () => {
        test('refuses every call without its permission, before anything else, in the words of Ruimte', async () => {
            const world = await open({});

            // `createNode` needs a node of the extension's own, or it throws for the wrong argument first.
            world.api.defineNode({ id: 'probe', title: 'Probe', component: async () => ({ default: () => null }) });

            expect(Object.keys(CALLS)).toEqual(Object.keys(EXTENSION_CLIENT_PERMISSIONS).filter((call) => !HOOKS.has(call)));

            for (const [call, ask] of Object.entries(CALLS)) {
                const message = `${NAME} did not ask for the permission ${EXTENSION_CLIENT_PERMISSIONS[call]} in its manifest`;

                expect({ call, answer: await ask(world.api) }).toStrictEqual({ call, answer: { ok: false, error: { code: 'permission-denied', message } } });
            }
        });

        test('keeps storage per scope, and reads it back in another surface', async () => {
            const world = await open({});
            const { api, createElement: h } = world;
            const Counts = () => {
                const scopes = (['computer', 'project', 'machine'] as const).map((scope) => [scope, ...api.useStorage('count', 0, scope)] as const);

                return h(
                    'div',
                    null,
                    scopes.map(([scope, count, set]) => h('button', { key: scope, type: 'button', onClick: () => set(count + 1) }, `${scope} ${count}`))
                );
            };
            const first = await world.render(Counts);

            await first.click('project 0');
            await first.until(() => first.text().includes('project 1'));

            const second = await world.render(Counts);

            await second.until(() => second.text() === 'computer 0project 1machine 0');
        });

        test('tells a slot what is true at its place, and hands the same to run', async () => {
            const world = await open({});
            const seen: object[] = [];
            const ran: { slot: string; signal: AbortSignal }[] = [];

            world.api.defineAction({
                id: 'probe',
                title: 'Probe',
                slots: {
                    nodeHeader: (context) => {
                        seen.push(context);

                        return context.node.title === 'First' && { title: 'Probe First' };
                    }
                },
                run: (context) => void ran.push(context)
            });
            world.api.defineAction({
                id: 'breaks',
                title: 'Breaks',
                slots: { viewToolbar: true },
                run: () => {
                    throw new Error('On purpose');
                }
            });

            expect(world.slot('probe', 'selectionBar', {})).toBeNull();
            expect(world.slot('probe', 'nodeHeader', { node: { id: 'note-1' } })).toBe('Probe First');
            expect(seen[0]).toMatchObject({
                project: SEED.project,
                view: SEED.view,
                machine: SEED.machine,
                theme: 'dark',
                node: { ...SEED.node, linkedTo: [], groupId: null, viewId: 'view-1' }
            });
            expect(await world.run('probe', 'nodeHeader', { node: { id: 'note-1' } })).toStrictEqual({ ok: true, value: undefined });
            expect(ran[0]).toMatchObject({ slot: 'nodeHeader', node: { id: 'note-1', title: 'First' } });
            expect(ran[0]?.signal).toBeInstanceOf(AbortSignal);
            expect(await world.run('breaks', 'viewToolbar', {})).toStrictEqual({ ok: false, error: { code: 'failed', message: 'On purpose' } });
            expect(world.failures()).toEqual([{ text: 'Breaks', detail: 'On purpose' }]);
        });

        test('writes a note beside a node and links the two, with value undefined for a link', async () => {
            const world = await open(ALL);
            const note = world.api.canvas.createNote({ title: 'Summary', text: 'Short', near: [{ id: 'note-1' }] });

            expect(note.ok).toBe(true);

            if (!note.ok) {
                return;
            }

            expect(world.api.canvas.link({ id: 'note-1' }, note.value)).toStrictEqual({ ok: true, value: undefined });
            expect(world.api.canvas.link({ id: 'gone' }, note.value)).toStrictEqual({
                ok: false,
                error: { code: 'not-found', message: 'No node gone on a canvas of this window' }
            });
            expect(world.notes()).toContainEqual({ title: 'Summary', text: 'Short' });
            expect(world.links()).toContainEqual({ from: 'note-1', to: note.value.id });
        });

        test('hands a client event to what listens, until it stops', async () => {
            const world = await open({});
            const heard: string[][] = [];
            const stop = world.api.onEvent('selection.changed', ({ nodes }) => void heard.push(nodes.map((node) => node.id)));

            world.select(['note-1']);
            stop();
            world.select([]);

            expect(heard).toEqual([['note-1']]);
        });
    });
}
