import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { useSettings } from '@/state/settings';
import { useWindow } from '@/workspace/window';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { installDesktop, removeDesktop } from '../../testing/dom-helpers';
import { machineBridge } from '../../testing/machine-bridge';

let page: Mounted;
let chosen: string[];
let choose: (mode: 'local' | 'none') => Promise<void>;

function text(): string {
    return page.host.textContent ?? '';
}

function button(label: string): HTMLButtonElement | null {
    return [...page.host.querySelectorAll('button')].find((element) => element.textContent?.includes(label)) ?? null;
}

function radio(label: string): HTMLElement | null {
    return [...page.host.querySelectorAll<HTMLElement>('[role="radio"]')].find((element) => element.textContent?.includes(label)) ?? null;
}

async function open(): Promise<void> {
    installDesktop({
        machine: machineBridge('ask', { choose: (mode) => choose(mode) })
    });
    page = mount();
    await page.renderApp();
    await until(() => text().includes('Welcome to Ruimte'));
}

beforeEach(() => {
    chosen = [];
    choose = async (mode) => {
        chosen.push(mode);
    };
    useWindow.getState().setBooting(false);
    useSettings.setState({ onboardingSkipWelcome: false });
});

afterEach(async () => {
    await page.unmount();
    useSettings.setState({ onboardingSkipWelcome: false });
    removeDesktop();
});

describe('the first start of a new install', () => {
    test('asks before anything else, with this computer running agents chosen', async () => {
        await open();
        expect(radio('Run agents on this computer')?.getAttribute('aria-checked')).toBe('true');
        expect(radio('Only connect to my machines')?.getAttribute('aria-checked')).toBe('false');
        expect(text()).not.toContain('Open folder');
    });

    test('Continue runs a machine here and marks the task list to open without the welcome', async () => {
        await open();
        await clickOn(button('Continue'));
        expect(chosen).toEqual(['local']);
        expect(useSettings.getState().onboardingSkipWelcome).toBe(true);
        expect(text()).toContain('Restarting…');
        expect(button('Restarting…')?.disabled).toBe(true);
    });

    test('connecting only sends none and leaves the welcome for the machine that never comes', async () => {
        await open();
        await clickOn(radio('Only connect to my machines'));
        await clickOn(button('Continue'));
        expect(chosen).toEqual(['none']);
        expect(useSettings.getState().onboardingSkipWelcome).toBe(false);
    });

    test('a choice that could not be saved says why and asks again', async () => {
        choose = () => Promise.reject(new Error('disk full'));
        await open();
        await clickOn(button('Continue'));
        await until(() => text().includes('Ruimte could not save this choice. disk full'));
        expect(button('Continue')?.disabled).toBe(false);
        expect(radio('Run agents on this computer')?.getAttribute('aria-checked')).toBe('true');
        expect(useSettings.getState().onboardingSkipWelcome).toBe(false);
    });

    test('Enter on Continue reaches the button untouched, which chooses what the group shows', async () => {
        await open();
        const next = button('Continue')!;
        next.focus();
        expect(document.activeElement).toBe(next);
        const enter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
        await act(async () => {
            next.dispatchEvent(enter);
        });
        // happy-dom has no default action for Enter on a button, so the click a browser sends stands in for it.
        expect(enter.defaultPrevented).toBe(false);
        await clickOn(next);
        expect(chosen).toEqual(['local']);
    });

    test('a failure of the shell itself is told in our own words', async () => {
        choose = () => Promise.reject(new Error("Error invoking remote method 'machine:choose': Error: EACCES: permission denied"));
        await open();
        await clickOn(button('Continue'));
        await until(() => text().includes('Ruimte could not save this choice. Try again.'));
        expect(text()).not.toContain('Error invoking');
    });

    test('the group comes before Continue, and both take the keyboard', async () => {
        await open();
        const group = page.host.querySelector('[role="radiogroup"]');
        const next = button('Continue');
        expect(group).not.toBeNull();
        expect(next).not.toBeNull();
        expect((group as Node).compareDocumentPosition(next as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(next?.tabIndex).toBe(0);
        expect(radio('Run agents on this computer')?.tabIndex).toBe(0);
    });
});
