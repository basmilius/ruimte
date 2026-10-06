import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectDocument, ProviderInfo } from '@ruimte/contracts';
import { EMPTY_DRAFT, readDraft, writeDraft } from '@adecore/agents-react/chat/drafts';
import { providerSinkFor } from '@adecore/agents-react/state/providers';
import { focusedCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { currentEndpointId } from '@/state/keys';
import { useChatChooser } from '@/chat/chat-chooser';
import { fenceOf, lineRangeLabel, offerSelection, selectionBlock, startLinkedChat, type SelectionOffer } from './selection-to-chat';

const node = (id: string, kind: 'file' | 'chat', x: number, extra: Record<string, unknown> = {}) => ({
    id,
    kind,
    title: id,
    x,
    y: 0,
    w: 300,
    h: 200,
    ...extra
});

function documentWith(chats: string[], edges: Array<[string, string]>): ProjectDocument {
    return {
        version: 3,
        rev: 1,
        name: 'Atlas',
        color: '#000',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Main',
                nodes: [node('score', 'file', 0, { path: 'src/score.ts' }), ...chats.map((id, at) => node(id, 'chat', 600 + at * 400))],
                texts: [],
                edges: edges.map(([from, to], at) => ({ id: `e${at}`, from, to })),
                layouts: []
            }
        ]
    } as ProjectDocument;
}

const offer: SelectionOffer = { block: 'src/score.ts:24-31\n```ts\nlet a = 1;\n```', label: 'score.ts:24-31', source: { nodeId: 'score' } };

beforeEach(() => {
    useChatChooser.getState().close();
    providerSinkFor(currentEndpointId()).setProviders([
        { kind: 'claude', name: 'Claude Code', installed: true, capabilities: { chat: true, terminal: true } } as unknown as ProviderInfo
    ]);
});

afterEach(() => {
    providerSinkFor(currentEndpointId()).setProviders([]);
    useDocument.getState().load(null, null);
    useChatChooser.getState().close();
    for (const id of ['first', 'second']) {
        writeDraft(id, EMPTY_DRAFT);
    }
});

describe('the block a selection becomes', () => {
    test('names the lines and fences the text with its language', () => {
        expect(selectionBlock(lineRangeLabel('src/score.ts', 24, 31), 'let a = 1;\n', 'ts')).toBe('src/score.ts:24-31\n```ts\nlet a = 1;\n```');
    });

    test('names a single line without a range, and a block without a language with a bare fence', () => {
        expect(lineRangeLabel('src/score.ts', 5, 5)).toBe('src/score.ts:5');
        expect(selectionBlock('build output', 'ok', null)).toBe('build output\n```\nok\n```');
    });

    test('is fenced longer than the longest run of backticks in the text', () => {
        expect(fenceOf('plain')).toBe('```');
        expect(fenceOf('a ``` b')).toBe('````');
        expect(fenceOf('`one` and `````five')).toBe('``````');
        expect(selectionBlock('x.md:1-3', '```js\nx\n```', 'md')).toBe('x.md:1-3\n````md\n```js\nx\n```\n````');
    });
});

describe('adding a selection to a chat', () => {
    test('goes straight to the draft of the one chat linked to the file, below what was typed, without opening the chooser', () => {
        useDocument.getState().load(documentWith(['first', 'second'], [['score', 'first']]), { activeViewId: 'main', views: {} });
        writeDraft('first', { ...EMPTY_DRAFT, text: 'Why is this slow?' });
        offerSelection(offer, { x: 0, y: 0 });
        expect(readDraft('first').text).toBe(`Why is this slow?\n\n${offer.block}\n\n`);
        expect(readDraft('second').text).toBe('');
        expect(useChatChooser.getState().request).toBeNull();
    });

    test('asks which chat when two are linked, or none, and sends nothing meanwhile', () => {
        useDocument.getState().load(
            documentWith(
                ['first', 'second'],
                [
                    ['score', 'first'],
                    ['second', 'score']
                ]
            ),
            { activeViewId: 'main', views: {} }
        );
        offerSelection(offer, { x: 10, y: 20 });
        expect(useChatChooser.getState().request).toEqual({ offer, x: 10, y: 20 });
        expect(readDraft('first').text).toBe('');

        useChatChooser.getState().close();
        useDocument.getState().load(documentWith(['first'], []), { activeViewId: 'main', views: {} });
        offerSelection(offer, { x: 0, y: 0 });
        expect(useChatChooser.getState().request).not.toBeNull();
    });

    test('a file in a tab always asks, since no line can start at a tab', () => {
        useDocument.getState().load(documentWith(['first'], [['score', 'first']]), { activeViewId: 'main', views: {} });
        offerSelection({ ...offer, source: { path: '/work/src/score.ts' } }, { x: 0, y: 0 });
        expect(useChatChooser.getState().request).not.toBeNull();
    });
});

describe('a new chat for a selection', () => {
    test('stands beside the file node with a line from it and the block in its draft', async () => {
        useDocument.getState().load(documentWith([], []), { activeViewId: 'main', views: {} });
        const chat = await startLinkedChat(offer, 'claude');
        expect(chat).not.toBeNull();
        const canvas = focusedCanvas().getState();
        expect(canvas.nodes[chat!]).toMatchObject({ kind: 'chat', provider: 'claude' });
        expect(canvas.nodes[chat!]!.x).toBeGreaterThan(canvas.nodes.score!.x + canvas.nodes.score!.w);
        expect(canvas.edges).toEqual([expect.objectContaining({ from: 'score', to: chat })]);
        expect(readDraft(chat!).text).toBe(`${offer.block}\n\n`);
    });

    test('makes the file of a tab a node first, so the line has somewhere to start', async () => {
        useDocument.getState().load(documentWith([], []), { activeViewId: 'main', views: {} });
        const chat = await startLinkedChat({ ...offer, source: { path: 'src/other.ts' } }, null);
        expect(chat).not.toBeNull();
        const canvas = focusedCanvas().getState();
        const file = Object.values(canvas.nodes).find((entry) => entry.kind === 'file' && entry.path === 'src/other.ts');
        expect(file).toBeDefined();
        expect(canvas.edges).toEqual([expect.objectContaining({ from: file!.id, to: chat })]);
    });

    test('gives up when there is no canvas to put it on', async () => {
        useDocument.getState().load(null, null);
        expect(await startLinkedChat({ ...offer, source: { path: 'src/other.ts' } }, null)).toBeNull();
    });
});
