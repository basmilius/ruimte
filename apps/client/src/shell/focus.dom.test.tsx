import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isApplePlatform } from '@adecore/ui';
import { act } from 'react';
import { StationMenu } from '@/shell/menu/StationMenu';
import { clickOn, mount, pressKey, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const VIEW = { kind: 'file', id: 'answer-view', name: 'answer.ts', path: 'src/answer.ts' };
const MOD = isApplePlatform() ? { metaKey: true } : { ctrlKey: true };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function input(): HTMLTextAreaElement | null {
    return page.host.querySelector('textarea[aria-label^="Code file"]');
}

function firstLine(): string {
    return page.host.querySelector('[data-line="0"]')?.textContent ?? '';
}

/* A row of an open menu, by its words and not the keys printed beside them; the popups are portaled out of the root. */
function menuRow(label: string): Element | null {
    return (
        [...document.querySelectorAll('[role="menuitem"]')].find((row) => [...row.querySelectorAll('span')].some((span) => span.textContent === label)) ?? null
    );
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('fs.read', () => ({ kind: 'text', text: 'const answer = 42;\n', encoding: 'utf-8', size: 19, mtime: 1, language: 'typescript' }) as never);
    machine.answer('fs.write', ({ text }) => ({ size: text.length, mtime: 2 }));
    workspace = await openFakeWorkspace(machine, { views: [VIEW] } as never, { activeViewId: VIEW.id, views: {} });
    page = mount();
    await page.renderApp(<StationMenu variant="symbol" />);
    await until(() => input() !== null && firstLine().includes('answer'));
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('the keyboard between the menu, the shortcuts and an editor', () => {
    test('a command picked in the menu runs in the editor the menu took the keyboard from, which gets it back', async () => {
        await act(async () => input()!.focus());
        await clickOn(page.host.querySelector('[aria-label="Menu"]'));
        await until(() => menuRow('Code') !== null);
        expect(document.activeElement).not.toBe(input());
        await clickOn(menuRow('Code'));
        await until(() => menuRow('Toggle Line Comment') !== null);
        await clickOn(menuRow('Toggle Line Comment'));
        await until(() => firstLine().startsWith('//'));
        expect(firstLine()).toBe('// const answer = 42;');
        expect(document.activeElement).toBe(input());
    });

    test('a window shortcut works from inside the editor, and closing what it opened puts the keyboard back', async () => {
        await act(async () => input()!.focus());
        await pressKey(input()!, 'k', MOD);
        await until(() => document.querySelector('[role="dialog"]') !== null);
        expect(firstLine()).toBe('const answer = 42;');
        await pressKey(document.activeElement!, 'Escape');
        await until(() => document.querySelector('[role="dialog"]') === null);
        expect(document.activeElement).toBe(input());
    });
});
