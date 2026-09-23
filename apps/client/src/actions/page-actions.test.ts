import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectDocument } from '@ruimte/contracts';
import { createClientActionRegistry, PERSON_ACTION_CALL, VOICE_ACTION_CALL } from './client-actions';
import type { PageDrive, PageMachine } from './page-actions';
import type { BrowserState } from '@/browser/registry';
import { defaultCanvases } from '@/state/canvas';
import { useDocument } from '@/state/document';

const main: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [
        { id: 'docs', kind: 'browser', title: 'Docs', x: 0, y: 0, w: 800, h: 600, url: 'https://example.com' },
        { id: 'blank', kind: 'browser', title: 'Blank', x: 900, y: 0, w: 800, h: 600 },
        { id: 'memo', kind: 'note', title: 'Memo', x: 0, y: 700, w: 240, h: 160 }
    ],
    texts: [],
    edges: [],
    layouts: []
};

const document: ProjectDocument = { version: 3, rev: 1, name: 'Atlas', color: '#000', views: [main] };

const row: BrowserState = {
    url: 'https://example.com/a',
    title: 'Example',
    loading: false,
    canGoBack: true,
    canGoForward: false,
    favicon: null,
    error: null,
    streamError: null,
    streamId: null
};

/* The pages this window holds, and every drive and address that reached them. */
const fakes = (held: readonly string[]) => {
    const drives: { nodeId: string; drive: PageDrive }[] = [];
    const assigned: { nodeId: string; url: string }[] = [];
    const machine: Partial<PageMachine> = {
        holds: (nodeId) => held.includes(nodeId),
        page: (nodeId) => (held.includes(nodeId) ? row : null),
        assign: (nodeId, url) => void assigned.push({ nodeId, url }),
        drive: (nodeId, drive) => void drives.push({ nodeId, drive })
    };
    return { drives, assigned, registry: createClientActionRegistry(useDocument, { pages: machine }) };
};

beforeEach(() => {
    useDocument.getState().load(document, { activeViewId: 'main', views: {} });
    defaultCanvases.of('main').getState().loadView(main, null);
    defaultCanvases.focus('main');
});

afterEach(() => {
    useDocument.getState().load(null, null);
    defaultCanvases.release('main');
    defaultCanvases.focus(null);
});

describe('page actions', () => {
    test('a page this window holds is read and driven; one nobody here holds is an answer, not an error', async () => {
        const { registry, drives } = fakes(['docs']);
        expect(await registry.execute('browser.inspect', { nodeId: 'docs' }, VOICE_ACTION_CALL)).toMatchObject({
            status: 'completed',
            output: { nodeId: 'docs', open: true, page: { url: 'https://example.com/a', title: 'Example', canGoBack: true }, error: null }
        });
        expect(await registry.execute('browser.back', { nodeId: 'docs' }, VOICE_ACTION_CALL)).toMatchObject({ status: 'completed' });
        expect(await registry.execute('browser.reload', { nodeId: 'docs', hard: true }, PERSON_ACTION_CALL)).toMatchObject({ status: 'completed' });
        const view = useDocument.getState().addStandaloneView({ kind: 'browser', name: 'Elsewhere', url: 'https://example.org' })!;
        expect(await registry.execute('browser.forward', { nodeId: view }, VOICE_ACTION_CALL)).toMatchObject({
            status: 'completed',
            output: { open: false, page: null }
        });
        expect(drives).toEqual([
            { nodeId: 'docs', drive: { kind: 'back' } },
            { nodeId: 'docs', drive: { kind: 'reload', hard: true } }
        ]);
    });

    test('an address goes to a page, and a node without one is given it instead', async () => {
        const { registry, drives, assigned } = fakes(['docs']);
        expect(await registry.execute('browser.navigate', { nodeId: 'docs', url: 'example.org/b' }, VOICE_ACTION_CALL)).toMatchObject({
            status: 'completed',
            output: { assigned: null }
        });
        expect(await registry.execute('browser.navigate', { nodeId: 'blank', url: 'localhost:5173' }, PERSON_ACTION_CALL)).toMatchObject({
            status: 'completed',
            output: { open: false, assigned: { url: 'http://localhost:5173', title: 'Blank' } }
        });
        expect(drives).toEqual([{ nodeId: 'docs', drive: { kind: 'go', url: 'https://example.org/b' } }]);
        expect(assigned).toEqual([{ nodeId: 'blank', url: 'http://localhost:5173' }]);
    });

    test('only a person sends a page anywhere but an http or https address', async () => {
        const { registry, drives } = fakes(['docs']);
        expect(await registry.execute('browser.navigate', { nodeId: 'docs', url: 'file:///etc/hosts' }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'bad-url' }
        });
        expect(await registry.execute('browser.navigate', { nodeId: 'docs', url: 'file:///repo/index.html' }, PERSON_ACTION_CALL)).toMatchObject({
            status: 'completed'
        });
        expect(drives).toEqual([{ nodeId: 'docs', drive: { kind: 'go', url: 'file:///repo/index.html' } }]);
    });

    test('a node that is not a browser has no page to drive', async () => {
        const { registry } = fakes(['memo']);
        expect(await registry.execute('browser.stop', { nodeId: 'memo' }, VOICE_ACTION_CALL)).toMatchObject({ error: { code: 'not-a-browser' } });
        expect(await registry.execute('browser.inspect', { nodeId: 'nope' }, VOICE_ACTION_CALL)).toMatchObject({ error: { code: 'not-a-browser' } });
    });
});
