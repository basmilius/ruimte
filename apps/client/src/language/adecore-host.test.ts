import { describe, expect, test } from 'bun:test';
import { EditorLanguage as SharedEditorLanguage, ProjectLanguage as SharedProjectLanguage } from '@adecore/editor-react';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { EditorLanguage } from './ruimte-editor-language';
import { ProjectLanguage } from './ruimte-project-language';
import { FakeLanguageTransport } from './fake-daemon';
import { ManualTimers } from '@adecore/editor-react/testing';
import { RUIMTE_EDITOR_KEYMAP } from '@/shell/editor-keymap';

async function settle(): Promise<void> {
    for (let turn = 0; turn < 150; turn++) {
        await Promise.resolve();
    }
}

describe('Adecore over the Ruimte language wire', () => {
    test('resolves and accepts a completion through the shared coordinator and keeps host shortcuts', async () => {
        const transport = new FakeLanguageTransport();
        transport.providers = { 'textDocument/completion': {}, 'completionItem/resolve': { resolveProvider: true } };
        transport.answers.set('language.request', (payload: { method: string; params: unknown }) => ({
            result:
                payload.method === 'completionItem/resolve'
                    ? {
                          ...(payload.params as object),
                          detail: 'consumerCompletion(): void',
                          additionalTextEdits: [
                              { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "import 'consumer';\n" }
                          ]
                      }
                    : { isIncomplete: false, items: [{ label: 'consumerCompletion', kind: 2 }] },
            server: 'typescript',
            version: 1
        }));
        const project = new ProjectLanguage(transport, 'p1', '/work/app');
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'consumerCom', theme: 'light' });
        editor.moveCaret({ line: 0, character: 11 });
        const timers = new ManualTimers();
        const language = new EditorLanguage(project, editor, 'file:///work/app/a.ts', 'typescript', timers);
        try {
            expect(project).toBeInstanceOf(SharedProjectLanguage);
            expect(language).toBeInstanceOf(SharedEditorLanguage);
            expect(language.keymap).toBe(RUIMTE_EDITOR_KEYMAP);
            await language.document.ready;
            language.completion.invoke();
            timers.advance(10);
            await settle();
            expect(editor.getText()).toBe("import 'consumer';\nconsumerCompletion()");
            expect(transport.callsOf('language.request').map((call) => (call.payload as { method: string }).method)).toContain('completionItem/resolve');
        } finally {
            language.dispose();
            project.dispose();
            await settle();
        }
        expect(transport.documents.size).toBe(0);
    });

    test('keeps machine diagnostics from documents another client owns', () => {
        const transport = new FakeLanguageTransport();
        const project = new ProjectLanguage(transport, 'p1', '/work/app');
        transport.emit('language.diagnostics', {
            projectId: 'p1',
            path: 'other.ts',
            server: 'typescript',
            version: 1,
            diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'Other client problem', severity: 1 }]
        });
        expect(project.machineProblems.getSnapshot()).toHaveLength(1);
        project.dispose();
    });
});
