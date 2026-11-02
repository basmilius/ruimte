import { afterEach, describe, expect, test } from 'bun:test';
import { act, createElement, type ComponentType } from 'react';
import type { ExtensionManifest, ProjectSummary } from '@ruimte/contracts';
import { clientApiFor, type LoadedExtension } from '@/extensions/host/client-api';
import { useHostDialog } from '@/extensions/host/host-dialog-state';
import { forgetExtension, registerExtension } from '@/extensions/host/runtime';
import { useContributions } from '@/extensions/registry';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
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

    test('refuses a path that leaves the project with backslashes', async () => {
        const { api } = loaded({ 'files.read': 'Reads notes' });

        useProject.setState({ current: PROJECT });

        await expect(api.files.readText('sub\\..\\..\\x')).rejects.toThrow('outside the project folder');
    });

    test('asks a person in their own words before it removes nodes', async () => {
        const { api } = loaded({ 'canvas.write': 'Tidies up' });
        const removing = api.canvas.remove([{ id: 'one' }]);

        await until(() => useHostDialog.getState().request !== null);

        expect(useHostDialog.getState().request?.title).toBe('Remove 1 node?');
        expect(useHostDialog.getState().request?.body).toBe('Probe asks to remove it.');

        useHostDialog.getState().request?.answer(null);

        expect(await removing).toBe(false);
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
