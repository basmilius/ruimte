import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { isApplePlatform } from '@/desktop/bridge';
import { canvasOfNode } from '@/state/canvas';
import { useServers } from '@/state/server';
import { useToasts } from '@/state/toasts';
import { windowWorkspace } from '@/state/window';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';

const SHELL: ProjectNode = { id: 'shell', kind: 'terminal', title: 'Shell', x: 0, y: 0, w: 560, h: 360 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [SHELL], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector(`[data-node-id="${SHELL.id}"] textarea`) !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('find in a terminal node', () => {
    test("the platform's find key in the terminal opens the find bar, and Escape closes it again", async () => {
        const apple = isApplePlatform();
        const textarea = page.host.querySelector(`[data-node-id="${SHELL.id}"] textarea`)!;
        await act(async () => (textarea as HTMLElement).focus());

        await pressKey(textarea, apple ? 'f' : 'F', apple ? { metaKey: true } : { ctrlKey: true, shiftKey: true });
        await until(() => page.host.querySelector('[data-find-bar]') !== null);

        const field = page.host.querySelector<HTMLInputElement>('[data-find-bar] input')!;
        await pressKey(field, 'Escape');
        await until(() => page.host.querySelector('[data-find-bar]') === null);
        expect(document.activeElement).toBe(textarea);
    });
});

/* A drag out of the file manager as a browser delivers it: bytes with a name, and the shell can say where each one lives. */
function finderDrag(type: 'dragover' | 'drop', ...paths: string[]): DragEvent {
    const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, 'dataTransfer', {
        value: {
            types: ['Files'],
            effectAllowed: 'all',
            dropEffect: 'none',
            items: paths.map((path) => ({ kind: 'file', getAsFile: () => ({ name: path }), webkitGetAsEntry: () => ({ isDirectory: path.endsWith('/dir') }) }))
        }
    });
    return event;
}

async function dispatch(target: Element, event: DragEvent): Promise<void> {
    await act(async () => {
        target.dispatchEvent(event);
    });
}

describe('a file dropped on a terminal node', () => {
    const bodyOf = (): Element => page.host.querySelector(`[data-node-id="${SHELL.id}"] .bg-term-bg`)!;

    async function serve(reachability: 'loopback' | 'lan', label: string): Promise<void> {
        await act(async () => useServers.setState({ byEndpoint: { 'fake-machine': { platform: 'darwin', reachability, label } as never } }));
    }

    beforeEach(async () => {
        await serve('loopback', 'Fake machine');
        await act(async () => useToasts.setState({ toasts: [] }));
    });

    afterEach(async () => {
        window.ruimteDesktop = undefined;
        await act(async () => useServers.setState({ byEndpoint: {} }));
    });

    test('types its quoted path without Enter, shows the ring while it is over and makes no node', async () => {
        window.ruimteDesktop = { platform: 'darwin', pathForFile: (file: { name: string }) => file.name } as never;

        const over = finderDrag('dragover', '/path/with space/file.png');
        await dispatch(bodyOf(), over);
        expect(over.defaultPrevented).toBe(true);
        expect(page.host.querySelector(`[data-node-id="${SHELL.id}"] .ring-accent`)).not.toBeNull();

        await dispatch(bodyOf(), finderDrag('drop', '/path/with space/file.png', '/work/dir'));
        await until(() => machine.requests('session.write').length > 0);
        expect(machine.requests('session.write')).toEqual([{ sessionId: SHELL.id, data: "'/path/with space/file.png' /work/dir " }]);
        expect(page.host.querySelector(`[data-node-id="${SHELL.id}"] .ring-accent`)).toBeNull();

        // Settled: a drop the canvas had taken would have added its nodes and saved the project by now.
        await act(async () => windowWorkspace()!.connection.projects.flush());
        expect(Object.keys(canvasOfNode(SHELL.id)!.getState().nodes)).toEqual([SHELL.id]);
        expect(machine.requests('project.save')).toEqual([]);
    });

    test.each([
        ['an escape that ends a bracketed paste', '/tmp/a\x1b[201~rm -rf ~'],
        ['a carriage return', '/tmp/a\rb'],
        ['a newline', '/tmp/a\nb']
    ])('with %s in a name it types nothing of the drop and says why', async (_name, bad) => {
        window.ruimteDesktop = { platform: 'darwin', pathForFile: (file: { name: string }) => file.name } as never;

        await dispatch(bodyOf(), finderDrag('drop', '/work/fine.png', bad));

        await until(() => useToasts.getState().toasts.length > 0);
        expect(useToasts.getState().toasts[0]?.title).toBe('That file name cannot be typed');
        expect(machine.requests('session.write')).toEqual([]);
    });

    test('on a project of another machine it types nothing and tells why', async () => {
        window.ruimteDesktop = { platform: 'darwin', pathForFile: (file: { name: string }) => file.name } as never;
        await serve('lan', 'Build server');

        await dispatch(bodyOf(), finderDrag('drop', '/work/a.png'));

        expect(machine.requests('session.write')).toEqual([]);
        expect(useToasts.getState().toasts[0]?.description).toBe('It cannot read files from Finder. Type or paste a path on that machine.');
    });
});
