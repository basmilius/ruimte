import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectDocument } from '@ruimte/contracts';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EMPTY_DRAFT, readDraft, writeDraft } from '@adecore/agents-react/chat/drafts';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { useChatChooser } from '@/chat/chat-chooser';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { EditorLanguage } from './ruimte-editor-language';
import { FakeLanguageTransport } from './fake-daemon';
import { eventOf } from './key-events';
import { LANGUAGE_COMMANDS } from './command-table';
import { ProjectLanguage } from './ruimte-project-language';

const uri = 'file:///work/app/src/score.ts';
const at = (line: number, character: number) => ({ line, character });

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
const document = (linked: boolean): ProjectDocument =>
    ({
        version: 3,
        rev: 1,
        name: 'Atlas',
        color: '#000',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Main',
                nodes: [node('score', 'file', 0, { path: 'src/score.ts' }), node('talk', 'chat', 600)],
                texts: [],
                edges: linked ? [{ id: 'e1', from: 'score', to: 'talk' }] : [],
                layouts: []
            }
        ]
    }) as ProjectDocument;

async function setup(text = 'let one = 1;\nlet two = 2;\nlet three = 3;\n') {
    const project = new ProjectLanguage(new FakeLanguageTransport(), 'p1', '/work/app');
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text, theme: 'light' });
    const language = new EditorLanguage(project, editor, uri, 'typescript');
    await language.document.ready;
    return { editor, language };
}

beforeEach(() => {
    useProject.setState({ current: { folder: '/work/app' } as never });
});

afterEach(() => {
    useDocument.getState().load(null, null);
    useChatChooser.getState().close();
    useProject.setState({ current: null });
    writeDraft('talk', EMPTY_DRAFT);
});

describe('adding the selection to a chat from the editor', () => {
    test('puts the selected lines, named by their path from the project folder, in the one chat the file node is linked to', async () => {
        useDocument.getState().load(document(true), { activeViewId: 'main', views: {} });
        const { editor, language } = await setup();
        language.selectionChat.bindNode('score');
        editor.setSelection({ start: at(0, 0), end: at(1, 13) });
        expect(editor.press(eventOf(CANVAS_SHORTCUTS.selectionToChat))).toBe(true);
        expect(readDraft('talk').text).toBe('src/score.ts:1-2\n```typescript\nlet one = 1;\nlet two = 2;\n```\n\n');
        expect(useChatChooser.getState().request).toBeNull();
    });

    test('takes the line under the caret when nothing is selected, and asks when no chat is linked', async () => {
        useDocument.getState().load(document(false), { activeViewId: 'main', views: {} });
        const { editor, language } = await setup();
        language.selectionChat.bindNode('score');
        editor.moveCaret(at(1, 4));
        language.selectionChat.choose();
        const { request } = useChatChooser.getState();
        expect(request?.offer.block).toBe('src/score.ts:2\n```typescript\nlet two = 2;\n```');
        expect(request?.offer.label).toBe('score.ts:2');
        expect(request?.offer.source).toEqual({ nodeId: 'score' });
        expect(readDraft('talk').text).toBe('');
    });

    test('a selection that ends at the start of a line leaves that line out, and a file in a tab offers its path', async () => {
        useDocument.getState().load(document(true), { activeViewId: 'main', views: {} });
        const { editor, language } = await setup();
        editor.setSelection({ start: at(0, 0), end: at(2, 0) });
        language.selectionChat.choose();
        const { request } = useChatChooser.getState();
        expect(request?.offer.label).toBe('score.ts:1-2');
        expect(request?.offer.source).toEqual({ path: '/work/app/src/score.ts' });
    });

    test('is a command of the Code menu with the key the editor table gives it', () => {
        expect(LANGUAGE_COMMANDS['selection-to-chat']).toMatchObject({ menu: 'code', key: 'selectionToChat', shortcut: CANVAS_SHORTCUTS.selectionToChat });
    });
});
