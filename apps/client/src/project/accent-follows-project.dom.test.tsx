import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DEFAULT_PROJECT_COLOR } from '@ruimte/contracts';
import { act } from 'react';
import { NODE_ACCENTS } from '@/canvas-model/accents';
import { projectSettingsAsk } from '@/project/dialogs';
import { useSettings } from '@/state/settings';
import { showStart } from '@/workspace/connections';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const BLUE = NODE_ACCENTS.find((entry) => entry.id === 'blue')!.color;
const RED = NODE_ACCENTS.find((entry) => entry.id === 'red')!.color;
const YELLOW = NODE_ACCENTS.find((entry) => entry.id === 'yellow')!.color;
const previousFollows = useSettings.getState().accentFollowsProject;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function sideRule(side: 'light' | 'dark'): string {
    const css = document.getElementById('ruimte-palette')?.textContent ?? '';

    return css.split('\n}').find((block) => block.includes(`[data-theme='${side}']`)) ?? '';
}

function accentOf(side: 'light' | 'dark'): string | undefined {
    return /--accent: (#[0-9a-f]{6});/.exec(sideRule(side))?.[1];
}

function swatch(name: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[role="radio"][aria-label="${name}"]`);
}

async function follow(on: boolean): Promise<void> {
    await act(async () => useSettings.getState().update({ accentFollowsProject: on }));
}

async function pick(name: string, color: string | null): Promise<void> {
    await act(async () => projectSettingsAsk.set(true));
    await until(() => swatch(name) !== null);
    await clickOn(swatch(name));
    await until(() => swatch(name)?.getAttribute('aria-checked') === 'true');

    if (color !== null) {
        await until(() => accentOf('light') === color);
    }
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    // The fixture's color is `#000`, which is no six-digit color, so the window starts on the chosen accent.
    workspace = await openFakeWorkspace(machine, { views: [] } as never, { activeViewId: null, views: {} } as never);
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await page.unmount();
    await follow(previousFollows);
    workspace.close();
});

describe('an accent that follows the project', () => {
    test('is the exact color of the project, with the contrast tokens of each side', async () => {
        await follow(true);
        expect(accentOf('light')).toBe(BLUE);

        await pick('Yellow', YELLOW);

        expect(accentOf('dark')).toBe(YELLOW);
        // Near-black text on yellow, on both sides, and the yellow as text darkened on the light ground only.
        expect(sideRule('light')).toContain('--accent-text: #18181b;');
        expect(sideRule('dark')).toContain('--accent-text: #18181b;');
        expect(sideRule('light')).toContain('--accent-on-surface: #');
        expect(sideRule('light')).not.toContain(`--accent-on-surface: ${YELLOW};`);
        expect(sideRule('dark')).toContain(`--accent-on-surface: ${YELLOW};`);
    });

    test('follows a change of the project color', async () => {
        await follow(true);
        await pick('Red', RED);
        expect(accentOf('light')).toBe(RED);

        await pick('Yellow', YELLOW);
        expect(accentOf('light')).toBe(YELLOW);
    });

    test('goes back to the chosen accent when the project returns to the default color', async () => {
        await follow(true);
        await pick('Red', RED);
        expect(accentOf('light')).toBe(RED);

        await act(async () => projectSettingsAsk.set(true));
        await clickOn(swatch('Default'));
        await until(() => accentOf('light') === BLUE);

        expect(DEFAULT_PROJECT_COLOR).not.toBe(BLUE);
        expect(sideRule('light')).not.toContain('--accent-on-surface');
    });

    test('keeps the chosen accent for a color that is no color, as the fixture has', async () => {
        await follow(true);

        expect(accentOf('light')).toBe(BLUE);
        expect(sideRule('light')).not.toContain('--accent-text');
        expect(sideRule('light')).not.toContain('--accent-on-surface');
    });

    test('keeps the chosen accent while the setting is off', async () => {
        await follow(false);
        await pick('Red', null);

        expect(accentOf('light')).toBe(BLUE);
        expect(sideRule('light')).not.toContain('--accent-on-surface');
    });

    test('is the chosen accent on the start screen', async () => {
        await follow(true);
        await pick('Red', RED);

        await act(async () => showStart());
        await until(() => accentOf('light') === BLUE);

        expect(sideRule('light')).not.toContain('--accent-on-surface');
    });

    test("stays this window's when another window rewrites the settings", async () => {
        await follow(true);
        await pick('Red', RED);

        await act(async () => useSettings.getState().reload());

        expect(accentOf('light')).toBe(RED);
    });
});
