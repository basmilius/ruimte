import { afterEach, describe, expect, test } from 'bun:test';
import { act, createElement, type ComponentType } from 'react';
import type { ExtensionManifest, ProjectSummary } from '@ruimte/contracts';
import { clientApiFor, type LoadedExtension } from '@/extensions/host/client-api';
import { useHostDialog } from '@/extensions/host/host-dialog-state';
import { forgetExtension, registerExtension } from '@/extensions/host/runtime';
import { useContributions } from '@/extensions/registry';
import { focusedCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { TransportError } from '@/transport';
import { connectFakeMachine, FakeMachine } from '../../../testing/fake-machine';
import { mount, until, type Mounted } from '../../../testing/dom';

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

let mounted: Mounted | null = null;
let disconnect: (() => void) | null = null;

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
});
