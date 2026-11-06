import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { keyOf } from '@adecore/editor-react/testing';
import { typeInto } from '@adecore/editor/testing';
import { isApplePlatform } from '@adecore/ui';
import { act } from 'react';
import { useSettings } from '@/state/settings';
import { CANVAS_SHORTCUTS } from '@/surface/canvas/shortcuts';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const MOD = isApplePlatform() ? { metaKey: true } : { ctrlKey: true };
const VIEW = { kind: 'file', id: 'greet-view', name: 'greet.ts', path: 'greet.ts' };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let version = 1;

function input(): HTMLTextAreaElement | null {
    return page.host.querySelector('textarea');
}

function rows(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')];
}

beforeEach(async () => {
    version = 1;
    machine = new FakeMachine();
    machine.answer('fs.read', () => ({ kind: 'text', text: '', encoding: 'utf-8', size: 0, mtime: 1, language: 'typescript' }) as never);
    machine.answer('fs.write', ({ text }) => ({ size: text.length, mtime: 2 }));
    machine.answer('language.document.open', () => ({
        version,
        servers: ['typescript'],
        providers: { 'textDocument/completion': { triggerCharacters: ['.'] } }
    }));
    machine.answer('language.document.change', () => ({ version: ++version }));
    machine.answer('language.request', ({ method }) => ({
        result:
            method === 'textDocument/completion'
                ? {
                      isIncomplete: false,
                      items: [
                          { label: 'greetAll', kind: 3 },
                          { label: 'greetAny', kind: 3 }
                      ]
                  }
                : null,
        server: 'typescript',
        version
    }));
    workspace = await openFakeWorkspace(machine, { views: [VIEW] } as never, { activeViewId: VIEW.id, views: {} });
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('the completion list of the editor', () => {
    test('one undo removes a whole accepted ghost suggestion and keeps the text that preceded it', async () => {
        const before = 'const prior = 1;\n';
        const suggestion = 'const next = 2;\nconst last = 3;';
        machine.answer('fs.read', () => ({ kind: 'text', text: before, encoding: 'utf-8', size: before.length, mtime: 1, language: 'typescript' }) as never);
        machine.answer('editor.status', () => ({ available: true }));
        machine.answer('editor.generate', () => ({ state: 'done' as const, text: suggestion }));
        const { aiCodeHelp, aiGhostText } = useSettings.getState();
        useSettings.setState({ aiCodeHelp: true, aiGhostText: 'request' });
        try {
            await page.renderApp();
            await until(() => input() !== null);
            await act(async () => input()!.focus());
            await pressKey(input()!, 'End', MOD);
            await act(async () => {
                input()!.dispatchEvent(new KeyboardEvent('keydown', { ...keyOf(CANVAS_SHORTCUTS.suggestInline), bubbles: true, cancelable: true }));
            });
            await until(() => page.host.querySelector('.se-ghost-accessory') !== null);
            await pressKey(input()!, 'Tab');
            await pressKey(input()!, 's', MOD);
            expect(machine.requests('fs.write').at(-1)?.text).toBe(`${before}${suggestion}\n`);
            // The first undo takes back the line break the save added; the second takes the whole suggestion.
            await pressKey(input()!, 'z', MOD);
            await pressKey(input()!, 'z', MOD);
            await pressKey(input()!, 's', MOD);
            expect(machine.requests('fs.write').at(-1)?.text).toBe(before);
        } finally {
            useSettings.setState({ aiCodeHelp, aiGhostText });
        }
    });

    test('leaves the keyboard in the text, so a key after a tool focused its row lands there', async () => {
        await page.renderApp();
        await until(() => input() !== null);
        await act(async () => input()!.focus());
        await act(async () => {
            typeInto(window, input()!, 'greetA');
        });
        // Ctrl+Space asks at once; the list a typed letter opens waits for a pause in the typing first.
        await act(async () => {
            input()!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true, bubbles: true, cancelable: true }));
        });
        await until(() => rows().length === 2);
        expect(document.activeElement).toBe(input());
        expect(rows().every((row) => row.tabIndex === -1)).toBe(true);

        // What Chromium does when an assistive tool sets AXFocused on the row `aria-activedescendant` names.
        const active = document.getElementById(input()!.getAttribute('aria-activedescendant')!)!;
        await act(async () => active.focus());
        expect(document.activeElement).toBe(input());

        await act(async () => {
            typeInto(window, input()!, ';');
        });
        await pressKey(input()!, 's', MOD);
        expect(machine.requests('fs.write').at(-1)?.text).toBe('greetA;\n');
    });
});
