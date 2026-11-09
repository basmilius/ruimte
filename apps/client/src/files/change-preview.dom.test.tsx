import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { FakeEditorEngine, type FakeEditor } from '@adecore/editor/fake';
import { act } from 'react';
import type { AgentHover } from '@/editor-ai/agent-changes';
import { ChatScopeProvider } from '@/workspace/ChatScopeProvider';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { FileChangeCard } from './FileChangeCard';

let workspace: FakeWorkspace;
let page: Mounted;
let editor: FakeEditor;
let machine: FakeMachine;
const attributed: AgentHover = {
    run: {
        id: 'run',
        chatId: 'author-chat',
        provider: 'claude',
        turnId: 'turn',
        turn: 4,
        at: 1000,
        promptExcerpt: 'Rename the value',
        start: 1,
        end: 1,
        review: 'pending',
        via: 'tool'
    },
    startLine: 1,
    endLine: 1,
    rect: { left: 60, right: 64, top: 20, bottom: 40 }
};

async function start(options: { readOnly?: boolean; text?: string; author?: AgentHover | null; kind?: 'modified' | 'deleted' } = {}) {
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [] }, { activeViewId: null, views: {} });
    editor = new FakeEditorEngine().mount(document.createElement('div'), {
        text: options.text ?? 'const newValue = 1;\n',
        theme: 'light',
        readOnly: options.readOnly
    });
    page = mount();
    const draw = async (author = options.author ?? null, base = 'const oldValue = 1;\n', path = '/work/code.ts') =>
        page.renderApp(
            <ChatScopeProvider>
                <FileChangeCard
                    editor={editor}
                    base={base}
                    path={path}
                    plain
                    readOnly={options.readOnly ? 'This file is read only' : null}
                    attribution={author}
                    onAttributionHold={() => undefined}
                />
            </ChatScopeProvider>
        );
    await draw();
    await act(async () =>
        editor.hoverChangeMark({ layer: 'git', line: 1, mark: { kind: options.kind ?? 'modified', startLine: 1, endLine: 1 }, rect: attributed.rect })
    );
    await until(() => document.querySelector('[role="dialog"][aria-label="Change since last commit"]') !== null);
    return draw;
}

afterEach(async () => {
    await page.unmount();
    editor.dispose();
    workspace.close();
});

describe('the file change card in the app', () => {
    test('asks the editor to render both sides and reverts its draft without a file or Git write', async () => {
        await start();
        expect(editor.codeBlocks.map((block) => block.text)).toEqual(['const oldValue = 1;', 'const newValue = 1;']);
        await clickOn([...document.querySelectorAll('button')].find((button) => button.textContent === 'Revert change')!);
        expect(editor.getText()).toBe('const oldValue = 1;\n');
        expect(document.querySelector('[aria-label="Change since last commit"]')).toBeNull();
        expect(machine.requests('fs.write')).toEqual([]);
        expect(machine.requests('git.action')).toEqual([]);
    });

    test('a refreshed base or a different file disposes the old card before it can edit', async () => {
        const draw = await start();
        const changedBase = 'const committedValue = 1;\n';
        await draw(null, changedBase);
        expect(document.querySelector('[aria-label="Change since last commit"]')).toBeNull();
        await act(async () => editor.hoverChangeMark({ layer: 'git', line: 1, mark: { kind: 'modified', startLine: 1, endLine: 1 }, rect: attributed.rect }));
        expect(editor.codeBlocks.at(-2)?.text).toBe('const committedValue = 1;');
        await draw(null, changedBase, '/work/other.ts');
        expect(document.querySelector('[aria-label="Change since last commit"]')).toBeNull();
        expect(editor.getText()).toBe('const newValue = 1;\n');
    });

    test('a read-only preview cannot revert and a large preview is visibly shortened', async () => {
        await start({ readOnly: true, text: 'x'.repeat(3000) });
        const revert = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Revert change');
        expect(revert?.disabled).toBe(true);
        expect(document.body.textContent).toContain('Preview shortened');
        expect(editor.codeBlocks.at(-1)?.text.length).toBe(2000);
    });

    test('an author arriving after the outer hover zone is retained for the current row', async () => {
        const draw = await start();
        expect(document.body.textContent).not.toContain('Written by');
        await draw(attributed);
        expect(document.body.textContent).toContain('Written by claude · Turn 4');
        await draw(null);
        expect(document.body.textContent).toContain('Written by claude · Turn 4');
    });

    test('a pure removal does not credit the adjacent unchanged row', async () => {
        await start({ text: '', kind: 'deleted', author: attributed });
        expect(document.body.textContent).not.toContain('Written by');
    });

    test('a failed preview recovers on the next hovered row in the same file', async () => {
        await start({ text: 'const newValue = 1;\nconst anotherValue = 2;\n' });
        const report = spyOn(console, 'error').mockImplementation(() => undefined);
        const render = spyOn(editor, 'renderCode').mockImplementation(() => {
            throw new Error('Preview rendering failed');
        });
        try {
            await act(async () => editor.hoverChangeMark({ layer: 'git', line: 2, mark: { kind: 'added', startLine: 2, endLine: 2 }, rect: attributed.rect }));
            expect(document.querySelector('[role="alert"]')?.textContent).toContain('Preview rendering failed');
            render.mockRestore();
            await act(async () =>
                editor.hoverChangeMark({ layer: 'git', line: 1, mark: { kind: 'modified', startLine: 1, endLine: 1 }, rect: attributed.rect })
            );
            expect(document.querySelector('[aria-label="Change since last commit"]')).not.toBeNull();
            expect(document.querySelector('[role="alert"]')).toBeNull();
        } finally {
            render.mockRestore();
            report.mockRestore();
        }
    });

    test('one change card retains the author after the attribution hover expires, and its link opens that card', async () => {
        const draw = await start({ author: attributed });
        await draw(null);
        expect(document.body.textContent).toContain('Written by claude · Turn 4');
        expect(document.body.textContent).not.toContain('Rename the value');
        await clickOn([...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Written by claude'))!);
        expect(document.querySelector('[aria-label="Change since last commit"]')).toBeNull();
        expect(document.body.textContent).toContain('Rename the value');
        expect(document.querySelectorAll('q')).toHaveLength(1);
    });
});
