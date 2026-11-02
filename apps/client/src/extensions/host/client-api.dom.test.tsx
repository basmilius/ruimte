import { afterEach, describe, expect, test } from 'bun:test';
import { act, createElement, type ComponentType } from 'react';
import { useChats } from '@adecore/agents-react/state';
import type { ExtensionManifest, ProjectSummary } from '@ruimte/contracts';
import { clientApiFor, type LoadedExtension } from '@/extensions/host/client-api';
import { useHostDialog } from '@/extensions/host/host-dialog-state';
import { forgetExtension, registerExtension } from '@/extensions/host/runtime';
import { useContributions } from '@/extensions/registry';
import { nodeInfoOf } from '@/extensions/slots';
import { ViewGlyph } from '@/project/ViewGlyph';
import { defaultCanvases, focusedCanvas } from '@/state/canvas';
import type { CanvasNode } from '@/state/canvas-model';
import { useDocument } from '@/state/document';
import { folderWatches } from '@/state/fs-watch';
import { LOCAL_ENDPOINT_ID, useEndpoints, type Endpoint } from '@/state/endpoints';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { TransportError } from '@/transport';
import { connectFakeMachine, FakeMachine } from '../../../testing/fake-machine';
import { clickOn, mount, until, type Mounted } from '../../../testing/dom';
import { idleChatInfo } from '../../../testing/project-fixtures';

const PROJECT: ProjectSummary = {
    projectId: 'project-a',
    name: 'A',
    color: '#000',
    folder: '/work/a',
    lastOpenedAt: 0,
    closedAt: null,
    available: true,
    icon: { kind: 'initial', value: 'A' },
    nameSource: 'chosen'
};

const SECOND: Endpoint = {
    id: 'second-machine',
    label: 'Second',
    httpBaseUrl: 'http://127.0.0.1:2',
    wsBaseUrl: 'ws://127.0.0.1:2',
    reachability: 'lan',
    daemonId: null,
    daemonPublicKey: null
};

let mounted: Mounted | null = null;
let disconnect: (() => void) | null = null;

/* This machine in front with `first`, and a second row behind `second` for the window to move to. */
function twoMachines(first: FakeMachine, second: FakeMachine): () => void {
    useEndpoints.getState().add(SECOND);

    const releaseFirst = connectFakeMachine(first);
    const releaseSecond = connectFakeMachine(second, SECOND.id);

    return () => {
        releaseSecond();
        releaseFirst();
        useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
        useEndpoints.getState().remove(SECOND.id);
    };
}

function loaded(permissions: Record<string, string> = {}): { extension: LoadedExtension; api: ReturnType<typeof clientApiFor> } {
    const manifest: ExtensionManifest = { id: 'acme.probe', name: 'Probe', version: '0.1.0', api: 1, permissions };
    const extension: LoadedExtension = { manifest, base: '/', disposers: [], settings: null };

    registerExtension(extension);

    return { extension, api: clientApiFor(extension) };
}

afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    disconnect?.();
    disconnect = null;
    forgetExtension('acme.probe');
    useHostDialog.getState().request?.answer(null);
    useProject.setState({ current: null });
});

describe('the client API', () => {
    test('stops what onEvent listens to when the extension goes', async () => {
        const { api } = loaded();
        const heard: (string | null)[] = [];

        api.onEvent('view.changed', ({ viewId }) => heard.push(viewId));
        useDocument.setState({ activeViewId: 'one' });
        forgetExtension('acme.probe');
        useDocument.setState({ activeViewId: 'two' });

        expect(heard).toEqual(['one']);
    });

    test('answers outside-project for a path that leaves the project with backslashes', async () => {
        const { api } = loaded({ 'files.read': 'Reads notes' });

        useProject.setState({ current: PROJECT });

        expect(await api.files.readText('sub\\..\\..\\x')).toEqual({
            ok: false,
            error: { code: 'outside-project', message: 'sub\\..\\..\\x is outside the project folder' }
        });
    });

    test('has the machine hold a read to the real project folder, so a symlink in it cannot lead out', async () => {
        const machine = new FakeMachine();
        const { api } = loaded({ 'files.read': 'Reads notes' });

        machine.answer('fs.read', () => {
            throw new TransportError('outside-project', 'Outside');
        });
        machine.answer('fs.list', () => ({ path: '/work/a/src', entries: [], truncated: false }));
        disconnect = connectFakeMachine(machine);
        useProject.setState({ current: PROJECT });

        expect(await api.files.readText('link.md')).toMatchObject({ ok: false, error: { code: 'outside-project' } });
        expect(await api.files.list('src')).toMatchObject({ ok: true });
        expect(machine.requests('fs.read')).toEqual([{ path: '/work/a/link.md', within: '/work/a' }]);
        expect(machine.requests('fs.list')).toEqual([{ path: '/work/a/src', within: '/work/a' }]);
    });

    test("shares a folder's watch with the files panel, and lets go of its own when the extension goes", async () => {
        const machine = new FakeMachine();
        const { api } = loaded({ 'files.read': 'Follows notes' });

        disconnect = connectFakeMachine(machine);
        useProject.setState({ current: PROJECT });

        const panel = folderWatches.watch(currentEndpointId(), '/work/a');
        const watched = api.files.watch('.', () => undefined);

        expect(watched.ok).toBe(true);

        if (watched.ok) {
            watched.value();
        }

        expect(machine.requests('fs.unwatch')).toEqual([]);

        panel.release();
        api.files.watch('src', () => undefined);
        forgetExtension('acme.probe');

        expect(machine.requests('fs.unwatch')).toEqual([{ path: '/work/a' }, { path: '/work/a/src' }]);
    });

    test('tells a watch of a file about a change a watcher of a folder above it could not name, and not about one it named elsewhere', async () => {
        const machine = new FakeMachine();
        const { api } = loaded({ 'files.read': 'Follows notes' });
        let heard = 0;

        disconnect = connectFakeMachine(machine);
        useProject.setState({ current: PROJECT });
        api.files.watch('notes/today.md', () => {
            heard += 1;
        });
        machine.emit('fs.changed', { root: '/work/a', paths: ['/work/a/notes'], changedPaths: ['/work/a/src/main.ts'] });
        machine.emit('fs.changed', { root: '/work/a', paths: ['/work/a/notes'] });
        machine.emit('fs.changed', { root: '/work/b', paths: ['/work/b'] });

        expect(heard).toBe(1);
    });

    test('reads, lists and writes no file on a machine that would leave out the project folder it is held to', async () => {
        const machine = new FakeMachine();
        const { api } = loaded({ 'files.read': 'Reads notes', 'files.write': 'Writes notes' });

        disconnect = connectFakeMachine(machine);
        machine.answersOnly(['fs.read', 'fs.list', 'fs.write', 'fs.create']);
        useProject.setState({ current: PROJECT });

        expect(await api.files.readText('link.md')).toMatchObject({ ok: false, error: { code: 'unavailable' } });
        expect(await api.files.list('.')).toMatchObject({ ok: false, error: { code: 'unavailable' } });
        expect(await api.files.write('notes.md', 'Hi')).toMatchObject({ ok: false, error: { code: 'unavailable' } });
        expect(machine.sent.filter((request) => request.type.startsWith('fs.'))).toEqual([]);
    });

    test('asks a machine from before the extension API nothing of it, and answers unavailable', async () => {
        const machine = new FakeMachine();
        const { api } = loaded({ 'launches.read': 'Lists launches', 'agents.run': 'Answers', 'context.read': 'Reads' });

        disconnect = connectFakeMachine(machine);
        machine.answersOnly(['chat.list', 'fs.read']);
        useProject.setState({ current: PROJECT });

        function Count() {
            const count = api.useServer<{ count(): Promise<number> }>().count.use();
            const [stored] = api.useStorage('count', 0, 'machine');

            return (
                <p>
                    {count.ok ? count.value : count.error.code} {stored}
                </p>
            );
        }

        api.defineSidebarCard({ id: 'count', title: 'Count', component: async () => ({ default: Count }) });

        const card = useContributions.getState().sidebarCards.find((each) => each.id === 'acme.probe/count');

        mounted = mount();
        await mounted.render(createElement(card?.component as ComponentType));
        await until(() => mounted?.host.textContent === 'unavailable 0');

        expect(await api.launches.list()).toMatchObject({ ok: false, error: { code: 'unavailable' } });
        expect(await api.agents.run({ prompt: 'Hi' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
        expect(await api.context.read({ nodes: [{ id: 'note-1' }] })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
        expect(machine.sent.filter((request) => request.type.startsWith('extension.'))).toEqual([]);
    });

    test('answers permission-denied for a call its manifest does not ask for, before anything else', async () => {
        const { api } = loaded();

        expect(api.canvas.createNote({ text: 'Hello' })).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
        expect(await api.git.status()).toMatchObject({ ok: false, error: { code: 'permission-denied' } });
    });

    test('answers no-canvas for a node with no canvas in front, and makes it once there is one', () => {
        const { api } = loaded({ 'canvas.write': 'Writes notes' });

        expect(api.canvas.createNote({ text: 'Hello' })).toMatchObject({ ok: false, error: { code: 'no-canvas' } });

        focusedCanvas().setState({ viewId: 'view-1' });

        const note = api.canvas.createNote({ text: 'Hello' });

        expect(note.ok).toBe(true);
        expect(note.ok && focusedCanvas().getState().nodes[note.value.id]?.body).toBe('Hello');
    });

    test("hands on the machine's refusal under its code, says it in the dev terminal, and throws only for an argument of the wrong shape", async () => {
        const machine = new FakeMachine();
        const { extension, api } = loaded({ 'chats.send': 'Pokes a chat' });

        extension.dev = true;
        disconnect = connectFakeMachine(machine);
        machine.answer('chat.send', ({ text }) => {
            throw new TransportError(text === '' ? 'bad-request' : 'forbidden', 'No');
        });

        expect(await api.chats.send('chat-1', 'Hello')).toEqual({ ok: false, error: { code: 'permission-denied', message: 'No' } });
        expect(machine.requests('extension.log').map(({ text }) => text)).toEqual(['[client] error: chats.send: permission-denied: No']);
        await expect(api.chats.send('chat-1', '')).rejects.toThrow(TypeError);
    });

    test("reads no chat for terminals.read, which only covers a terminal's screen", async () => {
        const machine = new FakeMachine();
        const { api } = loaded({ 'terminals.read': 'Reads a screen' });

        machine.answer('extension.contextRead', () => ({ sources: [{ id: 'chat-1', kind: 'chat', title: 'Chat', text: 'The thread' }] }));
        disconnect = connectFakeMachine(machine);
        useProject.setState({ current: PROJECT });

        expect(await api.terminals.read({ id: 'chat-1' })).toEqual({ ok: false, error: { code: 'not-found', message: 'No terminal chat-1 in this project' } });
        // The machine skips a chat before it reads; the check above holds for one from before `kind`.
        expect(machine.requests('extension.contextRead').map(({ kind }) => kind)).toEqual(['terminal']);
    });

    test('reads a chat with chats.read the way server/ does, also one that is no node on a canvas', async () => {
        const machine = new FakeMachine();
        const { api } = loaded({ 'chats.read': 'Reads a chat' });

        machine.answer('extension.contextRead', () => ({ sources: [] }));
        machine.answer('extension.chatRead', ({ chatId }) => ({ text: `The thread of ${chatId}` }));
        disconnect = connectFakeMachine(machine);
        useProject.setState({ current: PROJECT });

        expect(await api.chats.read('chat-1')).toEqual({ ok: true, value: 'The thread of chat-1' });
    });

    test('stops the run behind a stream that a loop broke off, and only that once', async () => {
        const machine = new FakeMachine();
        const { api } = loaded({ 'agents.run': 'Answers' });
        let finish = (): void => undefined;

        machine.answer('extension.agentStream', ({ runId }) => {
            machine.emit('extension.agentChunk', { runId, text: 'First' });

            return new Promise((resolve) => {
                finish = () => resolve({});
            });
        });
        disconnect = connectFakeMachine(machine);
        useProject.setState({ current: PROJECT });

        const signal = new AbortController();
        const pieces: string[] = [];

        for await (const piece of api.agents.stream({ prompt: 'Hi', signal: signal.signal })) {
            pieces.push(piece.ok ? piece.value.text : piece.error.code);
            break;
        }

        const stopped = machine.requests('extension.agentStop');

        signal.abort();
        finish();

        expect(pieces).toEqual(['First']);
        expect(stopped).toEqual([{ runId: machine.requests('extension.agentStream')[0]?.runId ?? '' }]);
        expect(machine.requests('extension.agentStop')).toHaveLength(1);
    });

    test('writes nothing once the window moves to another machine between reading the file and writing it', async () => {
        const first = new FakeMachine();
        const second = new FakeMachine();
        const { api } = loaded({ 'files.write': 'Writes notes' });
        let answerRead = (): void => undefined;

        first.answer('fs.read', () => new Promise((resolve) => (answerRead = () => resolve({ kind: 'text', text: 'Old', mtime: 7 } as never))));
        disconnect = twoMachines(first, second);
        useProject.setState({ current: PROJECT });

        const written = api.files.write('notes.md', 'New');

        await until(() => first.requests('fs.read').length === 1);
        useEndpoints.getState().setActive(SECOND.id);
        answerRead();

        expect(await written).toMatchObject({ ok: false, error: { code: 'unavailable' } });
        expect(first.sent.filter((request) => request.type === 'fs.write' || request.type === 'fs.create')).toEqual([]);
        expect(second.sent.filter((request) => request.type.startsWith('fs.'))).toEqual([]);
    });

    test('keeps a stream on the machine it began on: its chunks still come and its stop goes there after a switch', async () => {
        const first = new FakeMachine();
        const second = new FakeMachine();
        const { api } = loaded({ 'agents.run': 'Answers' });

        first.answer('extension.agentStream', () => new Promise(() => undefined));
        disconnect = twoMachines(first, second);
        useProject.setState({ current: PROJECT });

        const signal = new AbortController();
        const stream = api.agents.stream({ prompt: 'Hi', signal: signal.signal });
        const next = stream.next();

        await until(() => first.requests('extension.agentStream').length === 1);

        const runId = first.requests('extension.agentStream')[0]?.runId ?? '';

        useEndpoints.getState().setActive(SECOND.id);
        first.emit('extension.agentChunk', { runId, text: 'From the first' });

        expect(await next).toEqual({ done: false, value: { ok: true, value: { text: 'From the first' } } });

        signal.abort();

        expect(first.requests('extension.agentStop')).toEqual([{ runId }]);
        expect(second.requests('extension.agentStop')).toEqual([]);
        await stream.return(undefined);
    });

    test("hears a watched file's changes from the machine that holds the watch, not from a path of the same name on another", async () => {
        const first = new FakeMachine();
        const second = new FakeMachine();
        const { api } = loaded({ 'files.read': 'Follows notes' });
        let heard = 0;

        disconnect = twoMachines(first, second);
        useProject.setState({ current: PROJECT });
        api.files.watch('notes.md', () => {
            heard += 1;
        });
        useEndpoints.getState().setActive(SECOND.id);
        second.emit('fs.changed', { root: '/work/a/notes.md', paths: ['/work/a/notes.md'] });

        const fromSecond = heard;

        first.emit('fs.changed', { root: '/work/a/notes.md', paths: ['/work/a/notes.md'] });

        expect(fromSecond).toBe(0);
        expect(heard).toBe(1);
        expect(first.requests('fs.watch')).toEqual([{ path: '/work/a/notes.md' }]);
        expect(second.requests('fs.watch')).toEqual([]);
    });

    test('lets a callback of a load that was taken down read, change and stream nothing', async () => {
        const machine = new FakeMachine();
        const manifest: ExtensionManifest = {
            id: 'acme.probe',
            name: 'Probe',
            version: '0.1.0',
            api: 1,
            permissions: { 'files.read': 'Reads', 'agents.run': 'Answers' }
        };
        const extension: LoadedExtension = { manifest, base: '/', disposers: [], settings: null };
        const api = clientApiFor(extension, registerExtension(extension));
        let answerRead = (): void => undefined;

        machine.answer('fs.read', () => new Promise((resolve) => (answerRead = () => resolve({ kind: 'text', text: 'Secret', mtime: 1 } as never))));
        machine.answer('extension.agentStream', () => new Promise(() => undefined));
        disconnect = connectFakeMachine(machine);
        useProject.setState({ current: PROJECT });

        const panel = api.definePanel({ id: 'side', title: 'Side', component: async () => ({ default: () => null }) });
        const read = api.files.readText('notes.md');
        const stream = api.agents.stream({ prompt: 'Hi' });
        const next = stream.next();

        await until(() => machine.requests('fs.read').length === 1 && machine.requests('extension.agentStream').length === 1);
        forgetExtension('acme.probe');
        answerRead();
        panel.open();
        api.host.notify('Late');

        expect(await read).toMatchObject({ ok: false, error: { code: 'unavailable' } });
        expect(await next).toEqual({ done: true, value: undefined });
        expect(machine.requests('extension.agentStop')).toHaveLength(1);
        expect(useUi.getState().panel.kind).not.toBe('extension:acme.probe/side');
        expect(useToasts.getState().toasts.map((toast) => toast.title)).not.toContain('Late');
        expect(await api.files.list('.')).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    });

    test('starts no run for a signal that was aborted already', async () => {
        const machine = new FakeMachine();
        const { api } = loaded({ 'agents.run': 'Answers' });

        machine.answer('extension.agentStream', () => ({}));
        disconnect = connectFakeMachine(machine);
        useProject.setState({ current: PROJECT });

        const pieces: unknown[] = [];

        for await (const piece of api.agents.stream({ prompt: 'Hi', signal: AbortSignal.abort() })) {
            pieces.push(piece);
        }

        expect(pieces).toEqual([]);
        expect(machine.requests('extension.agentStream')).toEqual([]);
    });

    test('asks a person in their own words before it removes nodes, and answers refused when they keep them', async () => {
        const { api } = loaded({ 'canvas.write': 'Tidies up' });

        focusedCanvas().setState({ viewId: 'view-1' });

        const removing = api.canvas.remove([{ id: 'one' }]);

        await until(() => useHostDialog.getState().request !== null);

        expect(useHostDialog.getState().request?.title).toBe('Remove 1 node?');
        expect(useHostDialog.getState().request?.body).toBe('Probe asks to remove it.');

        useHostDialog.getState().request?.answer(null);

        expect(await removing).toMatchObject({ ok: false, error: { code: 'refused' } });
    });

    test('moves what an older version of a node stored up before it draws, and saves it with the version it is now', async () => {
        const { api } = loaded();

        function Counter() {
            const [data] = api.useNodeData<{ count: number }>();

            return <p>count {data.count}</p>;
        }

        api.defineNode<{ count: number }>({
            id: 'counter',
            title: 'Counter',
            dataVersion: 2,
            migrate: (stored) => ({ count: typeof stored === 'number' ? stored : 0 }),
            component: async () => ({ default: Counter })
        });

        const raw = { kind: 'extension', id: 'node-1', extension: 'acme.probe', type: 'counter', data: 5 };
        const node = { id: 'node-1', kind: 'unknown', title: 'Counter', x: 0, y: 0, w: 280, h: 160, raw } as CanvasNode;

        focusedCanvas().setState({ nodes: { 'node-1': node } });

        const contribution = useContributions.getState().extensionNodes.find((each) => each.id === 'acme.probe/counter');

        mounted = mount();
        await mounted.render(createElement(contribution?.component as ComponentType<{ nodeId: string }>, { nodeId: 'node-1' }));
        await until(() => mounted?.host.textContent === 'count 5');

        expect(focusedCanvas().getState().nodes['node-1']?.raw).toMatchObject({ data: { count: 5 }, dataVersion: 2 });
    });

    test('renames a node of an extension, whose title lives in what the extension stored', () => {
        const { api } = loaded({ 'canvas.write': 'Renames' });
        const raw = { kind: 'extension', id: 'node-1', extension: 'acme.probe', type: 'counter', title: 'Counter' };

        const canvas = defaultCanvases.of('view-rename');

        canvas.setState({
            viewId: 'view-rename',
            nodes: { 'node-1': { id: 'node-1', kind: 'unknown', title: 'Counter', x: 0, y: 0, w: 280, h: 160, raw } as CanvasNode }
        });

        try {
            expect(api.canvas.update({ id: 'node-1' }, { title: 'Tally' })).toEqual({ ok: true, value: undefined });
            expect(canvas.getState().nodes['node-1']).toMatchObject({ title: 'Tally', raw: { title: 'Tally' } });
        } finally {
            defaultCanvases.release('view-rename');
        }
    });

    test('marks a view of the extension in the lists with the icon its defineView names', async () => {
        const { api } = loaded();

        api.defineView({ id: 'dashboard', title: 'Dashboard', icon: 'gauge', component: async () => ({ default: () => null }) });
        useDocument.setState({
            views: [{ kind: 'unknown', id: 'view-9', name: 'Dashboard', raw: { kind: 'extension', id: 'view-9', extension: 'acme.probe', type: 'dashboard' } }]
        });

        mounted = mount();
        await mounted.render(<ViewGlyph id="view-9" kind="unknown" />);

        try {
            expect(mounted.host.querySelector('svg')?.getAttribute('class')).toContain('lucide-gauge');
        } finally {
            useDocument.setState({ views: [] });
        }
    });

    test('names the open group a node sits in, the innermost one, and each linked agent once', () => {
        const node = (id: string, kind: string, x: number, y: number, w: number, h: number) => ({ id, kind, title: id, x, y, w, h }) as CanvasNode;

        focusedCanvas().setState({
            nodes: {
                outer: node('outer', 'group', 0, 0, 1000, 1000),
                inner: node('inner', 'group', 100, 100, 400, 400),
                one: node('one', 'chat', 150, 150, 100, 100),
                two: node('two', 'chat', 700, 700, 100, 100)
            },
            edges: [
                { id: 'e1', from: 'one', to: 'two' },
                { id: 'e2', from: 'two', to: 'one' }
            ] as never
        });

        try {
            expect(nodeInfoOf('one')).toMatchObject({ groupId: 'inner', linkedTo: ['two'] });
            expect(nodeInfoOf('two')).toMatchObject({ groupId: 'outer', linkedTo: ['one'] });
        } finally {
            focusedCanvas().setState({ nodes: {}, edges: [] });
        }
    });

    test('names the CLI a chat runs on by its thread when the chat stores none', () => {
        const chat = { id: 'chat-1', kind: 'chat', title: 'Chat', x: 0, y: 0, w: 400, h: 300 } as CanvasNode;

        focusedCanvas().setState({ nodes: { 'chat-1': chat } });
        useChats.setState({
            statusByKey: { [endpointKey(currentEndpointId(), 'chat-1')]: { info: { ...idleChatInfo('chat-1'), provider: 'codex' } } }
        } as never);

        try {
            expect(nodeInfoOf('chat-1').agent?.provider).toBe('codex');
        } finally {
            useChats.setState({ statusByKey: {} });
        }
    });

    test.each(['project', 'machine'] as const)('a write to %s storage shows in every surface already drawn that reads the key', async (scope) => {
        const machine = new FakeMachine();
        const { api } = loaded();

        machine.answer('extension.storageGet', () => ({ value: 1 }));
        disconnect = connectFakeMachine(machine);
        useProject.setState({ current: PROJECT });

        function Writer() {
            const [count, setCount] = api.useStorage('count', 0, scope);

            return <button onClick={() => setCount(count + 1)}>writer {count}</button>;
        }

        function Reader() {
            const [count] = api.useStorage('count', 0, scope);

            return <p>reader {count}</p>;
        }

        api.defineSidebarCard({ id: 'writer', title: 'Writer', component: async () => ({ default: Writer }) });
        api.defineSidebarCard({ id: 'reader', title: 'Reader', component: async () => ({ default: Reader }) });

        const cards = useContributions.getState().sidebarCards.filter((each) => each.id.startsWith('acme.probe/'));

        mounted = mount();
        await mounted.render(<>{cards.map((card) => createElement(card.component, { key: card.id }))}</>);
        await until(() => mounted?.host.textContent === 'writer 1reader 1');
        await clickOn(mounted.host.querySelector('button'));

        expect(mounted.host.textContent).toBe('writer 2reader 2');
        expect(machine.requests('extension.storageSet')).toEqual([
            { id: 'acme.probe', key: scope === 'project' ? 'project:project-a:count' : 'count', value: 2 }
        ]);
    });

    test("a project's storage starts over in another project that has none", async () => {
        const machine = new FakeMachine();
        const { api } = loaded();

        machine.answer('extension.storageGet', ({ key }) => ({ value: key === 'project:project-a:count' ? 5 : undefined }));
        disconnect = connectFakeMachine(machine);
        useProject.setState({ current: PROJECT });

        function Count() {
            const [count] = api.useStorage('count', 0, 'project');

            return <p>count {count}</p>;
        }

        api.defineSidebarCard({ id: 'count', title: 'Count', component: async () => ({ default: Count }) });

        const card = useContributions.getState().sidebarCards.find((each) => each.id === 'acme.probe/count');

        mounted = mount();
        await mounted.render(createElement(card?.component as ComponentType));
        await until(() => mounted?.host.textContent === 'count 5');
        await act(async () => useProject.setState({ current: { ...PROJECT, projectId: 'project-b' } }));
        await until(() => machine.requests('extension.storageGet').length === 2);
        await act(async () => undefined);

        expect(mounted.host.textContent).toBe('count 0');
    });

    test("reads a machine's storage again once the connection opens, after a first read that failed", async () => {
        const machine = new FakeMachine();
        const { api } = loaded();

        machine.answer('extension.storageGet', () => ({ value: 7 }));
        disconnect = connectFakeMachine(machine);
        machine.drop();

        function Count() {
            const [count] = api.useStorage('count', 0, 'machine');

            return <p>count {count}</p>;
        }

        api.defineSidebarCard({ id: 'count', title: 'Count', component: async () => ({ default: Count }) });

        const card = useContributions.getState().sidebarCards.find((each) => each.id === 'acme.probe/count');

        mounted = mount();
        await mounted.render(createElement(card?.component as ComponentType));

        expect(mounted.host.textContent).toBe('count 0');

        await act(async () => machine.reopen());
        await until(() => mounted?.host.textContent === 'count 7');
    });

    test("shows what another client or server/ wrote to a machine's storage, and writes over it no older value", async () => {
        const machine = new FakeMachine();
        const { api } = loaded();

        machine.answer('extension.storageGet', () => ({ value: 1 }));
        disconnect = connectFakeMachine(machine);

        function Count() {
            const [count] = api.useStorage('count', 0, 'machine');

            return <p>count {count}</p>;
        }

        api.defineSidebarCard({ id: 'count', title: 'Count', component: async () => ({ default: Count }) });

        const card = useContributions.getState().sidebarCards.find((each) => each.id === 'acme.probe/count');

        mounted = mount();
        await mounted.render(createElement(card?.component as ComponentType));
        await until(() => mounted?.host.textContent === 'count 1');
        await act(async () => machine.emit('extension.storageChanged', { id: 'acme.probe', key: 'count', value: 5 }));

        expect(mounted.host.textContent).toBe('count 5');

        await act(async () => machine.emit('extension.storageChanged', { id: 'acme.probe', key: 'count' }));

        expect(mounted.host.textContent).toBe('count 0');

        await act(async () => machine.emit('extension.storageChanged', { id: 'acme.other', key: 'count', value: 9 }));

        expect(mounted.host.textContent).toBe('count 0');
    });

    test('goes back to what the machine holds when it refuses a write, and says so', async () => {
        const machine = new FakeMachine();
        const { api } = loaded();
        let write = (_next: number): void => undefined;

        machine.answer('extension.storageGet', () => ({ value: 1 }));
        machine.answer('extension.storageSet', () => {
            throw new TransportError('internal', 'The disk is full');
        });
        disconnect = connectFakeMachine(machine);

        function Count() {
            const [count, setCount] = api.useStorage('count', 0, 'machine');

            write = setCount;

            return <p>count {count}</p>;
        }

        api.defineSidebarCard({ id: 'count', title: 'Count', component: async () => ({ default: Count }) });

        const card = useContributions.getState().sidebarCards.find((each) => each.id === 'acme.probe/count');

        mounted = mount();
        await mounted.render(createElement(card?.component as ComponentType));
        await until(() => mounted?.host.textContent === 'count 1');
        await act(async () => write(2));
        await until(() => mounted?.host.textContent === 'count 1');

        expect(useToasts.getState().toasts.map((toast) => [toast.title, toast.description])).toContainEqual([
            'Probe could not keep what it stores',
            'storage count: The disk is full'
        ]);
    });

    test('says when it could not read what the machine answered for a key, rather than show it as never written', async () => {
        const machine = new FakeMachine();
        const { api } = loaded();

        machine.answer('extension.storageGet', () => {
            throw new TransportError('bad-reply', 'The reply did not fit');
        });
        disconnect = connectFakeMachine(machine);

        function Count() {
            const [count] = api.useStorage('count', 0, 'machine');

            return <p>count {count}</p>;
        }

        api.defineSidebarCard({ id: 'count', title: 'Count', component: async () => ({ default: Count }) });

        const card = useContributions.getState().sidebarCards.find((each) => each.id === 'acme.probe/count');

        mounted = mount();
        await mounted.render(createElement(card?.component as ComponentType));
        await until(() => useToasts.getState().toasts.some((toast) => toast.description === 'storage count: The reply did not fit'));
    });

    test("shows what another window wrote to this computer's storage and to a setting", async () => {
        const { api } = loaded();

        function Values() {
            const [count] = api.useStorage('count', 0);
            const mode = api.useSetting<string | undefined>('mode');

            return (
                <p>
                    count {count} mode {mode ?? 'none'}
                </p>
            );
        }

        api.defineSidebarCard({ id: 'values', title: 'Values', component: async () => ({ default: Values }) });

        const card = useContributions.getState().sidebarCards.find((each) => each.id === 'acme.probe/values');

        mounted = mount();
        await mounted.render(createElement(card?.component as ComponentType));

        expect(mounted.host.textContent).toBe('count 0 mode none');

        // What another window does: it writes the key, and only the other windows hear `storage`.
        await act(async () => {
            localStorage.setItem('ruimte.extension.acme.probe.count', '3');
            localStorage.setItem('ruimte.extension.acme.probe.setting.mode', '"dark"');
            window.dispatchEvent(new StorageEvent('storage', { key: 'ruimte.extension.acme.probe.count' }));
        });

        expect(mounted.host.textContent).toBe('count 3 mode dark');

        localStorage.removeItem('ruimte.extension.acme.probe.count');
        localStorage.removeItem('ruimte.extension.acme.probe.setting.mode');
    });

    test('asks server/ again for what .use() kept once reload drops it, also after a failure', async () => {
        const machine = new FakeMachine();
        const { api } = loaded();
        let key: string | null = null;

        machine.answer('extension.call', ({ method, args }) => {
            if (method === 'saveKey') {
                key = String(args[0]);

                return { result: null };
            }

            if (key === null) {
                throw new TransportError('failed', 'Add your tracker key');
            }

            return { result: ['FOO-1'] };
        });
        disconnect = connectFakeMachine(machine);

        function Tickets() {
            const tickets = api.useServer<{ tickets(): Promise<string[]> }>().tickets.use();

            return <p>{tickets.ok ? tickets.value.join(', ') : tickets.error.message}</p>;
        }

        function Settings() {
            const server = api.useServer<{ saveKey(key: string): Promise<void>; tickets(): Promise<string[]> }>();
            const save = async () => {
                await server.saveKey('secret');
                server.tickets.reload();
            };

            return <button onClick={() => void save()}>Save</button>;
        }

        api.defineSidebarCard({ id: 'tickets', title: 'Tickets', component: async () => ({ default: Tickets }) });
        api.defineSidebarCard({ id: 'settings', title: 'Settings', component: async () => ({ default: Settings }) });

        const cards = useContributions.getState().sidebarCards.filter((each) => each.id.startsWith('acme.probe/'));

        mounted = mount();
        await mounted.render(<>{cards.map((card) => createElement(card.component, { key: card.id }))}</>);
        await until(() => mounted?.host.textContent === 'Add your tracker keySave');
        await clickOn(mounted.host.querySelector('button'));
        await until(() => mounted?.host.textContent === 'FOO-1Save');

        expect(machine.requests('extension.call').map(({ method }) => method)).toEqual(['tickets', 'saveKey', 'tickets']);
    });

    test('asks server/ again for what .use() kept once the connection to the machine comes back', async () => {
        const machine = new FakeMachine();
        const { api } = loaded();
        let calls = 0;

        machine.answer('extension.call', () => {
            calls += 1;

            return { result: calls };
        });
        disconnect = connectFakeMachine(machine);

        function Count() {
            const count = api.useServer<{ count(): Promise<number> }>().count.use();

            return <p>call {count.ok ? count.value : count.error.code}</p>;
        }

        api.defineSidebarCard({ id: 'count', title: 'Count', component: async () => ({ default: Count }) });

        const card = useContributions.getState().sidebarCards.find((each) => each.id === 'acme.probe/count');

        mounted = mount();
        await mounted.render(createElement(card?.component as ComponentType));
        await until(() => mounted?.host.textContent === 'call 1');
        await act(async () => {
            machine.drop();
            machine.reopen();
        });
        await until(() => mounted?.host.textContent === 'call 2');
    });
});
