import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { projectSwitch } from '@/project/open';
import type { SwitchRun, SwitchTarget } from '@/project/project-switch';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const MACHINE = 'fake-machine';

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function screen(): HTMLElement | null {
    return (
        [...document.body.querySelectorAll<HTMLElement>('[role="status"]')].find(
            (status) => status.querySelector('img, svg') !== null && status.textContent?.includes('Try again') === true
        ) ?? null
    );
}

function buttonWithText(text: string): HTMLElement | null {
    return [...document.body.querySelectorAll<HTMLElement>('button')].find((candidate) => candidate.textContent?.trim() === text) ?? null;
}

/* A switch whose steps fail at once: before the machine answered, or once it did. */
function failingRun(reason: string, answered: boolean): SwitchRun {
    return {
        steps: async ({ opening }) => {
            if (answered) {
                opening();
            }
            throw new Error(reason);
        },
        back: async () => undefined
    };
}

beforeEach(async () => {
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [] }, { activeViewId: null, views: {} } as never);
    page = mount();
    await page.renderApp();
    await until(() => document.body.querySelector('main') !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('a machine that does not answer', () => {
    test('covers the whole workspace with the machine as the subject, and gives it back as it was', async () => {
        await act(async () => machine.lose());
        await until(() => screen() !== null);
        expect(screen()!.textContent).toContain('Fake machine is not answering. It may be asleep.');
        expect(screen()!.querySelector('img')).not.toBeNull();
        expect(buttonWithText('Open another project')).not.toBeNull();
        expect(document.body.querySelector('main')!.hasAttribute('inert')).toBe(true);

        await act(async () => machine.reopen());
        await until(() => screen() === null);
        expect(document.body.querySelector('main')!.hasAttribute('inert')).toBe(false);
    });

    test('a switch whose machine never answered shows the machine, and Go back returns', async () => {
        const target: SwitchTarget = { endpointId: MACHINE, summary: null, folder: '/work/website', name: null };
        await act(async () => {
            await projectSwitch.start(target, () => failingRun('No network path to the machine', false));
        });
        await until(() => buttonWithText('Go back') !== null);
        const card = buttonWithText('Go back')!.closest('[role="status"]')!;
        expect(card.textContent).toContain('Fake machine');
        expect(card.textContent).toContain('No network path to the machine');
        expect(card.textContent).not.toContain('website');
        expect(card.querySelector('img')).not.toBeNull();

        await clickOn(buttonWithText('Go back'));
        await until(() => buttonWithText('Go back') === null);
    });

    test('a switch whose project would not open while its machine answered keeps the project card', async () => {
        const target: SwitchTarget = { endpointId: MACHINE, summary: null, folder: '/work/website', name: null };
        await act(async () => {
            await projectSwitch.start(target, () => failingRun('The project folder is no longer there.', true));
        });
        await until(() => buttonWithText('Go back') !== null);
        const card = buttonWithText('Go back')!.closest('[role="status"]')!;
        expect(card.textContent).toContain('website');
        expect(card.textContent).toContain('The project folder is no longer there.');
        expect(card.querySelector('img')).toBeNull();

        await clickOn(buttonWithText('Go back'));
        await until(() => buttonWithText('Go back') === null);
    });
});
