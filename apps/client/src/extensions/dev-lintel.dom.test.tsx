import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Editor } from '@adecore/editor';
import { FakeEditor } from '@adecore/editor/fake';
import { useEditorDecorations } from '@/extensions/editor-decorations';
import type { LoadedExtension } from '@/extensions/host/client-api';
import { useFileLanguage } from '@/extensions/languages';
import { useContributions } from '@/state/extension-registry';
import { mount, until, type Mounted } from '../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { loadProduct } from '../../testing/poc';

let extension: LoadedExtension;
let page: Mounted | null = null;

function Language({ path, read }: { path: string; read?: string }) {
    return <p>{useFileLanguage(path, read) ?? 'none'}</p>;
}

function Margin({ editor, path }: { editor: Editor; path: string }) {
    useEditorDecorations(editor, path);

    return null;
}

beforeAll(async () => {
    extension = await loadProduct('lintel', 'Lintel');
});
afterAll(async () => {
    await page?.unmount();
    extension.disposers.forEach((dispose) => dispose());
});

describe('Lintel in the window', () => {
    test('names its config files as a language of its own, which a file the machine knows a language of keeps', async () => {
        page = mount();

        await page.render(
            <>
                <Language path="/work/a/rules.lintel" />
                <Language path="/work/a/Lintelfile" />
                <Language path="/work/a/app.ts" read="typescript" />
                <Language path="/work/a/notes.txt" />
            </>
        );

        expect(useContributions.getState().languages.map((language) => language.id)).toEqual(['dev.lintel/lintel']);
        expect(page.host.textContent).toBe('lintellinteltypescriptnone');
    });

    test('marks in the margin of an editor the lines its server part finds something on, and takes them out with the editor', async () => {
        const machine = new FakeMachine();
        const editor = new FakeEditor(document.createElement('div'), { text: '' } as never);
        const opened = mount();

        machine.answer('extension.call', ({ method }) => ({
            result:
                method === 'marks'
                    ? [
                          { line: 2, severity: 'information' },
                          { line: 7, severity: 'warning' }
                      ]
                    : null
        }));

        const disconnect = connectFakeMachine(machine);

        await opened.render(<Margin editor={editor} path="/work/a/src/app.ts" />);
        await until(() => editor.lineHighlights.length === 2);

        expect(machine.requests('extension.call')).toContainEqual({ id: 'dev.lintel', method: 'marks', args: ['/work/a/src/app.ts'] });
        expect(editor.lineHighlights).toEqual([
            { startLine: 2, endLine: 2, color: '--status-running', fill: 'transparent', sign: '●' },
            { startLine: 7, endLine: 7, color: '--status-needs-you', fill: 'transparent', sign: '●' }
        ]);

        await opened.unmount();

        expect(editor.lineHighlights).toEqual([]);

        disconnect();
    });
});
