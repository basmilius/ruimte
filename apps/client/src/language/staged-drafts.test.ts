import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import type { WorkspaceEdit } from '@adecore/lsp';
import { TextDrafts, useTextDrafts, type DraftLink } from '@/state/text-drafts';
import { useToasts } from '@/state/toasts';
import { FakeLanguageTransport } from './fake-daemon';
import { draftFiles } from './project-files';
import { EditorLanguage } from './ruimte-editor-language';
import { ProjectLanguage } from './ruimte-project-language';
import { settleLanguage } from './settle.test';

const GREETING = '/work/app/src/greeting.ts';
const MAIN = '/work/app/src/main.ts';
const greetingUri = `file://${GREETING}`;
const mainUri = `file://${MAIN}`;

const greetingText = (name: string) => `export function greet() {}\nexport function ${name}() {}\n`;
const mainText = (name: string) => `import { greet, ${name} } from './greeting';\ngreet();\n${name}();\n`;

/* The edit TypeScript answers a rename of `from` to `to` with: the declaration and the import and call of main.ts. */
function renameEdit(from: string, to: string): WorkspaceEdit {
    const word = (line: number, character: number) => ({
        range: { start: { line, character }, end: { line, character: character + from.length } },
        newText: to
    });
    return { changes: { [greetingUri]: [word(1, 16)], [mainUri]: [word(0, 16), word(2, 0)] } };
}

/* A machine with the two files on disk, whose `fs.read` and `fs.write` the drafts and the edit go through. */
function setup() {
    const disk = new Map([
        [GREETING, { text: greetingText('greetAll'), mtime: 1 }],
        [MAIN, { text: mainText('greetAll'), mtime: 1 }]
    ]);
    let clock = 1;
    const link: DraftLink = {
        read: async (path) => ({ kind: 'text', path, ...disk.get(path)! }) as never,
        write: async (path, text) => {
            clock += 1;
            disk.set(path, { text, mtime: clock });
            return { mtime: clock } as never;
        },
        projectOpen: async () => undefined
    };
    const drafts = new TextDrafts(() => link);
    const transport = new FakeLanguageTransport();
    transport.answers.set('fs.read', ((payload: { path: string }) => ({ kind: 'text', path: payload.path, ...disk.get(payload.path)! })) as never);
    const project = new ProjectLanguage(transport, 'p1', '/work/app', draftFiles('local', transport, 'p1', drafts));
    return { disk, drafts, transport, project };
}

beforeEach(() => {
    useToasts.setState({ toasts: [] });
    useTextDrafts.setState({ rows: {} });
});

afterEach(() => {
    useTextDrafts.setState({ rows: {} });
});

describe('a rename that changes a file no editor holds', () => {
    test('lets the servers read the unsaved text of that file, and a rename back leaves both files as they were', async () => {
        const { disk, drafts, transport, project } = setup();
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: greetingText('greetAll'), theme: 'light' });
        const language = new EditorLanguage(project, editor, greetingUri, 'typescript');
        await language.document.ready;

        expect(await project.applyWorkspaceEdit(renameEdit('greetAll', 'greetEveryone'))).toEqual({ applied: true });
        await settleLanguage();
        expect(drafts.draft('local', MAIN)?.text).toBe(mainText('greetEveryone'));
        expect(transport.documents.get('src/main.ts')?.text).toBe(mainText('greetEveryone'));
        expect(useToasts.getState().toasts).toHaveLength(1);

        expect(await project.applyWorkspaceEdit(renameEdit('greetEveryone', 'greetAll'))).toEqual({ applied: true });
        await settleLanguage();
        expect(editor.getText()).toBe(greetingText('greetAll'));
        expect(drafts.isUnsaved('local', MAIN)).toBe(false);
        expect(disk.get(MAIN)!.text).toBe(mainText('greetAll'));
        expect(transport.documents.has('src/main.ts')).toBe(false);
        expect(useToasts.getState().toasts).toEqual([]);

        language.dispose();
        project.dispose();
    });

    test('goes away from the toast once Save all wrote it, and the servers read it from disk again', async () => {
        const { disk, transport, project } = setup();
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: greetingText('greetAll'), theme: 'light' });
        const language = new EditorLanguage(project, editor, greetingUri, 'typescript');
        await language.document.ready;

        await project.applyWorkspaceEdit(renameEdit('greetAll', 'greetEveryone'));
        await settleLanguage();
        useToasts.getState().toasts[0]!.action!.run();
        await settleLanguage();

        expect(disk.get(MAIN)!.text).toBe(mainText('greetEveryone'));
        expect(useToasts.getState().toasts).toEqual([]);
        expect(transport.documents.has('src/main.ts')).toBe(false);

        language.dispose();
        project.dispose();
    });

    test('goes away from the toast when the file is saved some other way', async () => {
        const { drafts, project } = setup();
        await project.applyWorkspaceEdit(renameEdit('greetAll', 'greetEveryone'));
        await settleLanguage();
        expect(useToasts.getState().toasts).toHaveLength(1);

        await drafts.save('local', MAIN);
        await drafts.save('local', GREETING);
        expect(useToasts.getState().toasts).toEqual([]);
        project.dispose();
    });
});
