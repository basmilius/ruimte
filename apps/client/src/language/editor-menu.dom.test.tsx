import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ContextMenu } from '@adecore/ui';
import { act } from 'react';
import { useSettings } from '@/state/settings';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import type { EditorLanguage } from './ruimte-editor-language';
import { MenuActions } from './RuimteLanguagePopups';

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let explained = 0;

const language = {
    inlineEdit: { start: () => undefined },
    selectionChat: { choose: () => undefined, askAbout: () => undefined },
    explain: { explainHere: async () => void explained++ }
} as unknown as EditorLanguage;

function items(): string[] {
    return [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim() ?? '');
}

async function openMenu(): Promise<void> {
    await page.render(
        <ContextMenu.Root>
            <ContextMenu.Trigger data-testid="trigger">area</ContextMenu.Trigger>
            <ContextMenu.Popup>
                <MenuActions language={language} />
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
    await act(async () => {
        page.host
            .querySelector('[data-testid="trigger"]')!
            .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 2 }));
    });
    await until(() => document.querySelector('[role="menu"]') !== null);
}

beforeEach(async () => {
    explained = 0;
    useSettings.setState({ aiCodeHelp: true });
    machine = new FakeMachine();
    machine.answer('editor.status', () => ({ available: true }));
    workspace = await openFakeWorkspace(machine, { views: [] } as never, { activeViewId: null, views: {} });
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('the context menu of the editor', () => {
    test('offers Explain once the machine has the model, and explains from it', async () => {
        await openMenu();
        await until(() => items().includes('Explain'));

        await clickOn([...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent?.trim() === 'Explain') ?? null);

        expect(explained).toBe(1);
    });

    test('offers no Explain with the setting off', async () => {
        useSettings.setState({ aiCodeHelp: false });
        await openMenu();
        await until(() => items().some((item) => item.startsWith('Inline edit')));

        expect(items()).not.toContain('Explain');
    });

    test('offers no Explain on a machine without the model', async () => {
        machine.answer('editor.status', () => ({ available: false }));
        await openMenu();
        await until(() => items().some((item) => item.startsWith('Inline edit')));

        expect(items()).not.toContain('Explain');
    });
});
