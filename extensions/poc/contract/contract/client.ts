/*
 * What the client of an extension does, held the same way against the test host (`test/client.dom.test.ts`) and the
 * client host of Ruimte (`apps/client/src/extensions/host/contract.dom.test.tsx`), so the two cannot drift apart.
 * Each world seeds `SEED` and gives the API of `poc.contract` with the permissions a scenario asks for.
 */
import { describe, expect, test } from 'bun:test';
import { EXTENSION_CLIENT_PERMISSIONS } from '@ruimte/contracts/extension-client';
import { NODE_ACCENT_COLORS } from '@ruimte/contracts/node-accents';
import type * as Client from '../../../../packages/extension/client';
import type * as Ui from '../../../../packages/extension/ui';

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

/*
 * A node beside `SEED.node` on `SEED.view`: one an agent reads `text` of, or one of the extension's own as it was stored.
 * One with a `view` sits on that canvas of the project instead, which is not in front.
 */
export type SeedNode =
    | {
          id: string;
          kind: 'terminal' | 'chat';
          title: string;
          text: string;
          view?: string;
          agent?: SeedAgent;
          color?: Client.NodeColor;
          // A collapsed group hides it.
          hidden?: boolean;
          at?: { x: number; y: number };
      }
    | { id: string; kind: 'extension'; type: string; data: Client.Json; dataVersion?: number };

/*
 * What the agent in a seeded chat or terminal is doing: in a turn, or waiting on a person who may have put it off, and the
 * sub-agents a chat runs, with the node of a task's child. A terminal without one runs no agent.
 */
export interface SeedAgent {
    provider: string;
    doing: 'turn' | 'waits' | 'snoozed';
    subagents?: { node?: string }[];
}

/* What a scenario needs beside `SEED`: what the machine answers is the machine's own rule over it. */
export interface WorldSeed {
    nodes?: SeedNode[];
    /* Views beside `SEED.view`, which stays in front. */
    views?: { id: string; kind: string; name: string }[];
    /* The methods of `server/`, as `useServer` reaches them. */
    server?: Record<string, (...args: never[]) => unknown>;
    /* The pieces `agents.stream` answers. */
    stream?: string[];
    /* What the run does after its pieces: fail with this message, or wait until it is stopped. It ends by default. */
    streamEnd?: { fails: string } | 'waits';
    /* The run starts only once `letStreamStart` lets it, and gives its pieces even when it was stopped meanwhile. */
    streamStart?: 'held';
    /* The agents the machine can start. */
    providers?: { id: string; name: string }[];
    /* What is on screen of the canvas in front, at 100%; 1280 by 800 from its origin by default. */
    visible?: Client.CanvasArea;
}

export interface ClientWorld {
    api: typeof Client;
    /* `@ruimte/extension/ui` as the world hands it to an extension. */
    ui: typeof Ui;
    /* React of the world's own, so a component of a scenario draws with the copy that draws it. */
    createElement(type: unknown, props?: object | null, ...children: unknown[]): unknown;
    render(component: () => unknown): Promise<ContractScreen>;
    renderNode(type: string, nodeId: string): Promise<ContractScreen>;
    reconnect(): Promise<void>;
    /* Another window of the same computer writing a key of this extension's storage or a setting. */
    fromOtherWindow(write: { storage: string; value: Client.Json } | { setting: string; value: boolean | string }): Promise<void>;
    /* `server/` writing a key of the machine's storage, or deleting it without a value. */
    fromServer(write: { storage: string; value?: Client.Json }): Promise<void>;
    fileChanged(path: string): Promise<void>;
    /* Where each chat `agents.start` started went, in order. */
    started(): ('canvas' | 'view')[];
    /* Whether the machine was told to stop a run of `agents.stream`. */
    streamStopped(): boolean;
    /* Settles once a run of `agents.stream` was asked to start. */
    streamAsked(): Promise<void>;
    /* Lets a run held by `streamStart` start. */
    letStreamStart(): void;
    nodes(): string[];
    /* The title an action shows with at a place, or null where it does not show. */
    slot(action: string, place: Client.SlotName, extra: object): string | null;
    /* Presses an action at a place as a person would: a throw is `failed`, which a person is shown. */
    run(action: string, place: Client.SlotName, extra: object): Promise<Result<void>>;
    select(ids: string[]): void;
    notes(): { title: string; text: string }[];
    links(): { from: string; to: string }[];
    /* What a person was shown of a failed action: its title and why. */
    failures(): { text: string; detail: string }[];
    /* Each view `views.focus` handed the keyboard to. */
    focused(): string[];
}

export type OpenClientWorld = (permissions: Record<string, string>, seed?: WorldSeed) => Promise<ClientWorld>;

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
    'artifacts.publish': (api) => api.artifacts.publish({ files: [{ name: 'a.txt', text: 'a' }] }),
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
const HOOKS = new Set(['useAgents', 'useAgent', 'useSubagents', 'useUsageLimits', 'Chat']);

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

        test('reads the nodes it names and those on the view it names, each once, and nothing when it names neither', async () => {
            const { api } = await open({ 'context.read': 'Reads' });
            const ids = async (of: Parameters<typeof api.context.read>[0]) => {
                const read = await api.context.read(of);

                return read.ok ? read.value.map((source) => source.id) : read;
            };

            expect(await ids({})).toEqual([]);
            expect(await ids({ nodes: [REF] })).toEqual(['note-1']);
            expect(await ids({ view: { id: 'view-1' } })).toEqual(['note-1']);
            expect(await ids({ nodes: [REF], view: { id: 'view-1' } })).toEqual(['note-1']);
            expect(await ids({ view: { id: 'view-2' } })).toEqual([]);
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

        test('makes a node of its own with the size and data its definition starts with', async () => {
            const world = await open(ALL);
            const { api, createElement: h } = world;
            const Counter = () => h('p', null, `count ${api.useNodeData<{ count: number }>()[0].count}`);

            api.defineNode({
                id: 'counter',
                title: 'Counter',
                size: { width: 200, height: 100 },
                initialData: { count: 1 },
                // Drawn with the world's own React, which this file does not type.
                component: async () => ({ default: Counter as () => null })
            });

            const made = api.canvas.createNode('counter');

            if (!made.ok) {
                throw new Error(made.error.message);
            }

            const node = await world.renderNode('counter', made.value.id);
            const Size = () => {
                const { bounds } = api.useNode(made.value.id);

                return h('p', null, `${bounds.width} by ${bounds.height}`);
            };
            const size = await world.render(Size);

            await node.until(() => node.text() === 'count 1');

            expect(size.text()).toBe('200 by 100');
        });

        test('reads nothing of another kind: a chat with terminals.read, a terminal with chats.read', async () => {
            const { api } = await open(
                { 'terminals.read': 'Reads', 'chats.read': 'Reads' },
                {
                    nodes: [
                        { id: 'shell-1', kind: 'terminal', title: 'Shell', text: 'The screen' },
                        { id: 'chat-1', kind: 'chat', title: 'Chat', text: 'The thread' }
                    ]
                }
            );

            expect(await api.terminals.read({ id: 'shell-1' })).toStrictEqual({ ok: true, value: 'The screen' });
            expect(await api.chats.read('chat-1')).toStrictEqual({ ok: true, value: 'The thread' });
            expect(await api.terminals.read({ id: 'chat-1' })).toStrictEqual({
                ok: false,
                error: { code: 'not-found', message: 'No terminal chat-1 in this project' }
            });
            expect(await api.chats.read('shell-1')).toMatchObject({ ok: false });
        });

        test('starts an agent as a node on the canvas in front, and as a view of its own with no canvas there', async () => {
            const world = await open({ 'agents.start': 'Starts' }, { views: [{ id: 'page', kind: 'browser', name: 'Page' }] });
            const onCanvas = await world.api.agents.start({ prompt: 'Hi' });

            world.api.views.open({ id: 'page' });

            const alone = await world.api.agents.start({ prompt: 'Hi' });

            expect([onCanvas.ok, alone.ok]).toEqual([true, true]);
            expect(world.started()).toEqual(['canvas', 'view']);
        });

        test('moves what an older version of a node stored up before it draws', async () => {
            const world = await open({}, { nodes: [{ id: 'counter-1', kind: 'extension', type: 'counter', data: 5 }] });
            const { api, createElement: h } = world;
            const Counter = () => h('p', null, `count ${api.useNodeData<{ count: number }>()[0].count}`);

            api.defineNode({
                id: 'counter',
                title: 'Counter',
                dataVersion: 2,
                migrate: (stored, from) => ({ count: typeof stored === 'number' && from === 1 ? stored : 0 }),
                // Drawn with the world's own React, which this file does not type.
                component: async () => ({ default: Counter as () => null })
            });

            const node = await world.renderNode('counter', 'counter-1');

            await node.until(() => node.text() === 'count 5');
        });

        test('draws the components of @ruimte/extension/ui', async () => {
            const world = await open({});
            const screen = await world.render(() => world.createElement(world.ui.Button, { variant: 'secondary' }, 'Save'));

            expect(screen.text()).toBe('Save');
        });

        test('asks server/ again for what .use() kept after reload, and after the connection to the machine comes back', async () => {
            let calls = 0;
            const world = await open(
                {},
                {
                    server: {
                        count: () => {
                            calls += 1;

                            return calls;
                        }
                    }
                }
            );
            const { api, createElement: h } = world;
            const Count = () => {
                const server = api.useServer<{ count(): Promise<number> }>();
                const count = server.count.use();

                return h('button', { type: 'button', onClick: () => server.count.reload() }, `call ${count.ok ? count.value : count.error.code}`);
            };
            const screen = await world.render(Count);

            await screen.until(() => screen.text() === 'call 1');
            await screen.click('call 1');
            await screen.until(() => screen.text() === 'call 2');
            await world.reconnect();
            await screen.until(() => screen.text() === 'call 3');
        });

        test("shows what another window wrote to this computer's storage and to a setting", async () => {
            const world = await open({});
            const { api, createElement: h } = world;
            const Values = () => {
                const [count] = api.useStorage('count', 0);
                // Undefined until a person or another window sets it, with no default of a schema.
                const mode: string | undefined = api.useSetting<string>('mode');

                return h('p', null, `count ${count} mode ${mode ?? 'none'}`);
            };
            const screen = await world.render(Values);

            await world.fromOtherWindow({ storage: 'count', value: 3 });
            await world.fromOtherWindow({ setting: 'mode', value: 'dark' });
            await screen.until(() => screen.text() === 'count 3 mode dark');
        });

        test('yields nothing for a stream whose signal was aborted before it started', async () => {
            const { api } = await open({ 'agents.run': 'Answers' }, { stream: ['First', 'Second'] });
            const read = async (signal?: AbortSignal): Promise<string[]> => {
                const pieces: string[] = [];

                for await (const piece of api.agents.stream({ prompt: 'Hi', ...(signal === undefined ? {} : { signal }) })) {
                    pieces.push(piece.ok ? piece.value.text : piece.error.code);
                }

                return pieces;
            };

            expect(await read(AbortSignal.abort())).toEqual([]);
            expect(await read()).toEqual(['First', 'Second']);
        });

        test('ends a stream that fails after some pieces with that failure', async () => {
            const { api } = await open({ 'agents.run': 'Answers' }, { stream: ['First', 'Second'], streamEnd: { fails: 'Broke' } });
            const pieces: string[] = [];

            for await (const piece of api.agents.stream({ prompt: 'Hi' })) {
                pieces.push(piece.ok ? piece.value.text : `${piece.error.code}: ${piece.error.message}`);
            }

            expect(pieces).toEqual(['First', 'Second', 'failed: Broke']);
        });

        test('stops the run of a stream aborted after its first piece, which then says no more', async () => {
            const world = await open({ 'agents.run': 'Answers' }, { stream: ['First'], streamEnd: 'waits' });
            const controller = new AbortController();
            const pieces: string[] = [];

            for await (const piece of world.api.agents.stream({ prompt: 'Hi', signal: controller.signal })) {
                pieces.push(piece.ok ? piece.value.text : piece.error.code);
                controller.abort();
            }

            expect(pieces).toEqual(['First']);
            expect(world.streamStopped()).toBe(true);
        });

        test('stops the run of a stream aborted while it starts, which then says nothing of what came late', async () => {
            const world = await open({ 'agents.run': 'Answers' }, { stream: ['Late'], streamStart: 'held' });
            const controller = new AbortController();
            const reading = (async () => {
                const pieces: string[] = [];

                for await (const piece of world.api.agents.stream({ prompt: 'Hi', signal: controller.signal })) {
                    pieces.push(piece.ok ? piece.value.text : piece.error.code);
                }

                return pieces;
            })();

            await world.streamAsked();
            controller.abort();
            world.letStreamStart();

            expect(await reading).toEqual([]);
            expect(world.streamStopped()).toBe(true);
        });

        test('answers failed for any throw of server/, and not-found for a name it only inherits', async () => {
            const world = await open(
                {},
                {
                    server: {
                        breaks: () => {
                            throw new TypeError('On purpose');
                        }
                    }
                }
            );
            type Probe = { breaks(): Promise<void>; toString(): Promise<string> };
            const held: { server?: Client.ServerClient<Probe> } = {};

            await world.render(() => {
                held.server = world.api.useServer<Probe>();

                return null;
            });

            const server = held.server as Client.ServerClient<Probe>;

            expect(await server.breaks()).toStrictEqual({ ok: false, error: { code: 'failed', message: 'On purpose' } });
            expect(await server.toString()).toStrictEqual({ ok: false, error: { code: 'not-found', message: 'No method toString' } });
        });

        test('calls server/ outside a component with getServer, answering as useServer does', async () => {
            const world = await open(
                {},
                {
                    server: {
                        greet: (name: string) => `Hello ${name}`,
                        breaks: () => {
                            throw new Error('On purpose');
                        }
                    }
                }
            );
            const server = world.api.getServer<{ greet(name: string): Promise<string>; breaks(): Promise<void> }>();

            expect(await server.greet('Bas')).toStrictEqual({ ok: true, value: 'Hello Bas' });
            expect(await server.breaks()).toStrictEqual({ ok: false, error: { code: 'failed', message: 'On purpose' } });
        });

        test('reads its initial value for a key deleted with undefined, here or by server/, also after the connection comes back', async () => {
            const world = await open({});
            const { api, createElement: h } = world;
            const Count = () => {
                const [count, setCount] = api.useStorage<number | undefined>('count', 0, 'machine');

                return h('button', { type: 'button', onClick: () => setCount(count === 1 ? undefined : 1) }, `count ${count}`);
            };
            const screen = await world.render(Count);

            await screen.click('count 0');
            await screen.until(() => screen.text() === 'count 1');
            await screen.click('count 1');
            await screen.until(() => screen.text() === 'count 0');
            await screen.click('count 0');
            await screen.until(() => screen.text() === 'count 1');
            await world.fromServer({ storage: 'count' });
            await world.reconnect();
            await screen.until(() => screen.text() === 'count 0');
        });

        test('opens a canvas it makes, so the note it makes next lands there', async () => {
            const world = await open({ ...ALL, 'views.write': 'Makes' });
            const { api, createElement: h } = world;
            const made = api.views.createCanvas('Next');

            if (!made.ok) {
                throw new Error(made.error.message);
            }

            const note = api.canvas.createNote({ text: 'Hi' });

            if (!note.ok) {
                throw new Error(note.error.message);
            }

            const Where = () => h('p', null, `${api.useActiveView().id} ${api.useNode(note.value.id).viewId}`);
            const screen = await world.render(Where);

            expect(screen.text()).toBe(`${made.value.id} ${made.value.id}`);
        });

        test('makes a note the size and title of a note, centered beside its node on the grid, and selects it', async () => {
            const world = await open(ALL);
            const { api, createElement: h } = world;
            const note = api.canvas.createNote({ text: 'Hi', near: [REF] });

            if (!note.ok) {
                throw new Error(note.error.message);
            }

            const Made = () => {
                const { title, bounds } = api.useNode(note.value.id);
                const selected = api.useSelection().map((node) => node.id);

                return h('p', null, JSON.stringify({ title, bounds, selected }));
            };
            const screen = await world.render(Made);

            expect(JSON.parse(screen.text())).toEqual({ title: 'Note', bounds: { x: 400, y: -16, width: 320, height: 240 }, selected: [note.value.id] });
        });

        test('groups only nodes of the canvas in front in the frame a person would draw, and selects the group', async () => {
            const world = await open(ALL, { nodes: [{ id: 'far-1', kind: 'terminal', title: 'Far', text: '', view: 'view-2' }] });
            const { api, createElement: h } = world;
            const group = api.canvas.group([REF, { id: 'far-1' }]);

            if (!group.ok) {
                throw new Error(group.error.message);
            }

            const Made = () => {
                const { kind, bounds } = api.useNode(group.value.id);
                const selected = api.useSelection().map((node) => node.id);

                return h('p', null, JSON.stringify({ kind, bounds, selected }));
            };
            const screen = await world.render(Made);

            expect(JSON.parse(screen.text())).toEqual({ kind: 'group', bounds: { x: -32, y: -72, width: 384, height: 304 }, selected: [group.value.id] });
            expect(api.canvas.group([{ id: 'far-1' }])).toStrictEqual({
                ok: false,
                error: { code: 'refused', message: 'These nodes make no group on the canvas in front' }
            });
        });

        test('draws no line from a node to itself, and both ways between two agents', async () => {
            const world = await open(ALL, {
                nodes: [
                    { id: 'shell-1', kind: 'terminal', title: 'Shell', text: '' },
                    { id: 'chat-1', kind: 'chat', title: 'Chat', text: '' }
                ]
            });

            world.api.canvas.link(REF, REF);
            world.api.canvas.link({ id: 'shell-1' }, { id: 'chat-1' });

            expect(world.links()).toEqual([
                { from: 'shell-1', to: 'chat-1' },
                { from: 'chat-1', to: 'shell-1' }
            ]);
        });

        test('removes only what is on the canvas in front, and leaves nothing selected', async () => {
            const world = await open(ALL, { nodes: [{ id: 'shell-1', kind: 'terminal', title: 'Shell', text: '' }] });
            const { api, createElement: h } = world;

            world.select(['note-1', 'shell-1']);

            expect(await api.canvas.remove([REF])).toStrictEqual({ ok: true, value: undefined });

            const Selected = () => h('p', null, `selected ${api.useSelection().length}`);
            const screen = await world.render(Selected);

            expect(screen.text()).toBe('selected 0');
            expect(world.nodes()).toEqual(['shell-1']);
        });

        test('reads a node of another canvas as unknown', async () => {
            const world = await open({}, { nodes: [{ id: 'far-1', kind: 'terminal', title: 'Far', text: '', view: 'view-2' }] });
            const { api, createElement: h } = world;
            const Far = () => h('p', null, api.useNode('far-1').kind);
            const screen = await world.render(Far);

            expect(screen.text()).toBe('unknown');
        });

        test('reads the agent of a chat and of a terminal its CLI runs in, and none of a plain terminal', async () => {
            const world = await open(
                { 'agents.status': 'Shows' },
                {
                    nodes: [
                        { id: 'chat-1', kind: 'chat', title: 'Chat', text: '', agent: { provider: 'codex', doing: 'turn' } },
                        { id: 'shell-1', kind: 'terminal', title: 'Agent', text: '', agent: { provider: 'claude', doing: 'snoozed' } },
                        { id: 'shell-2', kind: 'terminal', title: 'Shell', text: '' }
                    ]
                }
            );
            const { api, createElement: h } = world;
            const line = (id: string): string => {
                const agent = api.useAgent({ id });

                return agent === null ? `${id} none` : `${id} ${agent.provider} ${agent.status} ${agent.activity} ${agent.snoozed}`;
            };
            const Agents = () => h('p', null, ['chat-1', 'shell-1', 'shell-2'].map(line).join(', '));
            const screen = await world.render(Agents);

            await screen.until(() => screen.text().includes('chat-1 codex'));

            expect(screen.text()).toBe('chat-1 codex running turn false, shell-1 claude needsYou null true, shell-2 none');
        });

        test('reads the sub-agents a chat has at work, with the node of a task it gave', async () => {
            const world = await open(
                { 'agents.status': 'Shows' },
                {
                    nodes: [
                        {
                            id: 'chat-1',
                            kind: 'chat',
                            title: 'Chat',
                            text: '',
                            agent: { provider: 'claude', doing: 'turn', subagents: [{ node: 'chat-2' }, {}] }
                        },
                        { id: 'chat-2', kind: 'chat', title: 'Child', text: '', agent: { provider: 'claude', doing: 'turn' } }
                    ]
                }
            );
            const { api, createElement: h } = world;
            const Kids = () =>
                h(
                    'p',
                    null,
                    api
                        .useSubagents({ id: 'chat-1' })
                        .map((kid) => `${kid.status} ${kid.node?.id ?? 'none'}`)
                        .join(', ')
                );
            const screen = await world.render(Kids);

            await screen.until(() => screen.text() !== '');

            expect(screen.text()).toBe('running chat-2, running none');
        });

        test('reads a node a collapsed group hides as hidden, and its color by its accent and as it is drawn', async () => {
            const world = await open(
                {},
                {
                    nodes: [
                        { id: 'chat-1', kind: 'chat', title: 'Chat', text: '', color: 'blue' },
                        { id: 'shell-1', kind: 'terminal', title: 'Shell', text: '', hidden: true }
                    ]
                }
            );
            const { api, createElement: h } = world;
            const Nodes = () => {
                const chat = api.useNode('chat-1');
                const shell = api.useNode('shell-1');

                return h('p', null, `${chat.color} ${chat.hidden} ${shell.color} ${shell.hidden}`);
            };
            const screen = await world.render(Nodes);

            expect(screen.text()).toBe('blue false null true');
            expect(api.nodeColorValue('blue')).toBe(NODE_ACCENT_COLORS.blue);
            expect(() => api.nodeColorValue('plaid' as Client.NodeColor)).toThrow(TypeError);
        });

        test('reads what is on screen of the canvas, and whether a node is in view', async () => {
            const world = await open(
                {},
                {
                    nodes: [{ id: 'far-1', kind: 'terminal', title: 'Far', text: '', at: { x: 4000, y: 4000 } }],
                    visible: { x: 0, y: 0, width: 1280, height: 800 }
                }
            );
            const { api, createElement: h } = world;
            const View = () => {
                const area = api.useCanvasView((view) => `${view.visible.width}x${view.visible.height} ${view.zoom} ${view.gesture}`);

                return h('p', null, `${area} ${api.useInView({ id: 'note-1' })} ${api.useInView({ id: 'far-1' })}`);
            };
            const screen = await world.render(View);

            expect(screen.text()).toBe('1280x800 1 none true false');
        });

        test('hands the keyboard to a view it names, and refuses a canvas overlay in a space it does not know', async () => {
            const world = await open({});

            world.api.views.focus({ id: SEED.view.id });

            expect(world.focused()).toEqual([SEED.view.id]);
            expect(() => world.api.defineCanvasOverlay({ id: 'odd', component: async () => ({ default: () => null }), space: 'paper' as 'canvas' })).toThrow(
                TypeError
            );
        });

        test('tells a widget beside a view of its own which view it is, and where the composer lies', async () => {
            const world = await open({});

            world.api.defineAction({
                id: 'beside',
                title: 'Beside',
                slots: { viewAccessory: (context) => ({ title: `${context.target.kind} ${context.composer?.top ?? 'none'}` }) },
                run: () => undefined
            });

            expect(world.slot('beside', 'viewAccessory', { target: { id: 'c', kind: 'chat' }, composer: { top: 4, right: 20, width: 400 } })).toBe('chat 4');
            expect(world.slot('beside', 'viewAccessory', { target: { id: 't', kind: 'terminal' }, composer: null })).toBe('terminal none');
        });

        test('lists the agents the machine can start', async () => {
            const world = await open({}, { providers: [{ id: 'codex', name: 'Codex' }] });
            const { api, createElement: h } = world;
            const Providers = () =>
                h(
                    'p',
                    null,
                    api
                        .useProviders()
                        .map((provider) => `${provider.id} ${provider.name}`)
                        .join(', ')
                );
            const screen = await world.render(Providers);

            await screen.until(() => screen.text() !== '');

            expect(screen.text()).toBe('codex Codex');
        });

        test('reads a chat it started in a view of its own', async () => {
            const world = await open({ 'agents.start': 'Starts', 'chats.read': 'Reads' }, { views: [{ id: 'page', kind: 'browser', name: 'Page' }] });

            world.api.views.open({ id: 'page' });

            const started = await world.api.agents.start({ prompt: 'Hi' });

            if (!started.ok) {
                throw new Error(started.error.message);
            }

            expect(await world.api.chats.read(started.value.id)).toMatchObject({ ok: true });
        });

        test('keeps a view of its own as a view of a kind Ruimte does not know, as useViews reads it', async () => {
            const world = await open({});
            const { api, createElement: h } = world;

            api.defineView({ id: 'board', title: 'Board', component: async () => ({ default: () => null }) }).open();

            const Kinds = () =>
                h(
                    'p',
                    null,
                    api
                        .useViews()
                        .map((view) => `${view.name} ${view.kind}`)
                        .join(', ')
                );
            const screen = await world.render(Kinds);

            expect(screen.text()).toBe('Plan canvas, Board unknown');
        });

        test('tells a watch of a folder that a file under it changed, until it stops', async () => {
            const world = await open({ 'files.read': 'Reads' });
            let heard = 0;
            const watch = world.api.files.watch('notes', () => {
                heard += 1;
            });

            if (!watch.ok) {
                throw new Error(watch.error.message);
            }

            await world.fileChanged('notes/today.md');
            await world.fileChanged('other.md');
            watch.value();
            await world.fileChanged('notes/today.md');

            expect(heard).toBe(1);
        });

        test('says nothing when it opens the view in front, and shows no failure for an action a person stopped', async () => {
            const world = await open({});
            const heard: (string | null)[] = [];

            world.api.onEvent('view.changed', ({ viewId }) => void heard.push(viewId));
            world.api.views.open({ id: 'view-1' });
            world.api.defineAction({
                id: 'stops',
                title: 'Stops',
                slots: { viewToolbar: true },
                run: () => {
                    throw new DOMException('Stopped', 'AbortError');
                }
            });

            expect(heard).toEqual([]);
            expect(await world.run('stops', 'viewToolbar', {})).toStrictEqual({ ok: true, value: undefined });
            expect(world.failures()).toEqual([]);
        });
    });
}
