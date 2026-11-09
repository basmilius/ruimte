import { describe, expect, test } from 'bun:test';
import { ManualTimers, settle } from '@adecore/editor-react/testing';
import { FakeEditorEngine } from '@adecore/editor/fake';
import { RUIMTE_EDITOR_KEYMAP } from '@/surface/editor-keymap';
import { installWorkspaceRegistries } from '@/wiring/workspace-registries';
import { FakeLanguageTransport } from './fake-daemon';
import { createEditorLanguage } from './ruimte-editor-language';
import { RuimteProject } from './ruimte-project';

// An editor is drawn only in a workspace, whose chunk installs this before it draws one (`App.tsx`).
installWorkspaceRegistries();

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
        const project = new RuimteProject(transport, 'p1', '/work/app');
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'consumerCom', theme: 'light' });
        editor.moveCaret({ line: 0, character: 11 });
        const timers = new ManualTimers();
        const language = createEditorLanguage(project, editor, 'file:///work/app/a.ts', 'typescript', timers);
        try {
            expect(language.keymap).toEqual(RUIMTE_EDITOR_KEYMAP);
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
        const project = new RuimteProject(transport, 'p1', '/work/app');
        transport.emit('language.diagnostics', {
            projectId: 'p1',
            path: 'other.ts',
            server: 'typescript',
            version: 1,
            diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'Other client problem', severity: 1 }]
        });
        transport.emit('language.diagnostics', {
            projectId: 'p2',
            path: 'elsewhere.ts',
            server: 'typescript',
            version: 1,
            diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'Another project', severity: 1 }]
        });
        expect(project.language.problems.getSnapshot().map((file) => file.path)).toEqual(['other.ts']);
        project.dispose();
    });
});
