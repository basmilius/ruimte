import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { clipboard } from '@adecore/editor/testing';
import { act } from 'react';
import { isApplePlatform } from '@/desktop/bridge';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const MOD = isApplePlatform() ? { metaKey: true } : { ctrlKey: true };
const VIEW = { kind: 'file', id: 'notes-view', name: 'notes.txt', path: 'notes.txt' };
const TEXT = 'one\ntwo\n';

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function input(): HTMLTextAreaElement | null {
    return page.host.querySelector('textarea');
}

function rows(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')];
}

async function copyLine(): Promise<void> {
    await act(async () => {
        clipboard(window, input()!, 'copy');
    });
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('fs.read', () => ({ kind: 'text', text: TEXT, encoding: 'utf-8', size: TEXT.length, mtime: 1, language: 'text' }) as never);
    machine.answer('fs.write', ({ text }) => ({ size: text.length, mtime: 2 }));
    workspace = await openFakeWorkspace(machine, { views: [VIEW] } as never, { activeViewId: VIEW.id, views: {} });
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('Paste from History in a file no language server serves', () => {
    test('lists the copies of the project, newest first, and pastes the one that was picked without a word to the language servers', async () => {
        await page.renderApp();
        await until(() => input() !== null);
        await act(async () => input()!.focus());
        await pressKey(input()!, 'Home', MOD);
        await copyLine();
        await pressKey(input()!, 'ArrowDown');
        await copyLine();

        await pressKey(input()!, 'v', { ...MOD, shiftKey: true });
        await until(() => rows().length === 2);
        expect(rows().map((row) => row.textContent)).toEqual([expect.stringContaining('two'), expect.stringContaining('one')]);

        await pressKey(input()!, 'ArrowDown');
        await pressKey(input()!, 'Enter');
        await until(() => rows().length === 0);
        await pressKey(input()!, 's', MOD);

        expect(machine.requests('fs.write').at(-1)?.text).toContain('one');
        expect(machine.requests('fs.write').at(-1)?.text.length).toBeGreaterThan(TEXT.length);
        expect(machine.requests('language.document.open')).toHaveLength(0);
    });
});
