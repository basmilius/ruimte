import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ChatSubagentItem, ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { browserSheetReader, usePetSprites } from '@/pets/custom-sprites';
import { canvasOfNode } from '@/state/canvas';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { chatInfoOf } from '../../../testing/chat-info';
import { FakeMachine } from '../../../testing/fake-machine';
import { clickOn, until } from '../../../testing/dom';
import { buttonWithText, everything, typeInto } from '../../../testing/dom-helpers';
import { openCanvasPage, type CanvasPage } from '../../../testing/canvas-page';
import { claudeProvider, fakeProvider } from '../../../testing/fake-provider';

const WRITER: ProjectNode = { id: 'writer', kind: 'chat', title: 'Writer', x: 2000, y: 1000, w: 480, h: 520 };
const PLAN: ProjectNode = { id: 'plan', kind: 'note', title: 'Plan', body: 'Ship it', x: 0, y: 0, w: 400, h: 320 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [PLAN, WRITER], texts: [], edges: [], layouts: [] };
const VIEWPORT = { w: 1280, h: 800 };

let machine: FakeMachine;
let canvas: CanvasPage;

function pet(id: string): HTMLElement | null {
    return canvas.page.host.querySelector(`[data-pet="${id}"]`);
}

function kids(id: string): HTMLElement[] {
    return [...canvas.page.host.querySelectorAll<HTMLElement>(`[data-pet-kid="${id}"]`)];
}

function subagent(id: string): ChatSubagentItem {
    return {
        id,
        kind: 'subagent',
        turnId: null,
        createdAt: 1,
        toolUseId: `spawn-${id}`,
        description: id,
        subagentType: null,
        prompt: null,
        background: true,
        status: 'running',
        startedAt: 1,
        finishedAt: null,
        summary: null,
        result: null,
        usage: null,
        lastTool: null,
        itemsTruncated: false
    };
}

/* The writer's thread holds these sub-agents once its node attaches it. */
function attachWith(items: ChatSubagentItem[]): void {
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: chatId === WRITER.id ? items : [], seq: 1 }) as never);
}

function petsSwitch(): HTMLElement | null {
    return document.querySelector('[role="switch"][aria-label="Pets"]');
}

function store() {
    return canvasOfNode(PLAN.id)!;
}

async function open(): Promise<void> {
    canvas = await openCanvasPage(machine, [MAIN], PLAN.id);
    await act(async () => {
        store().getState().setViewport(VIEWPORT);
        store().getState().setCamera({ x: 0, y: 0, zoom: 1 });
    });
}

beforeEach(() => {
    machine = new FakeMachine();
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await canvas.close();
    useSettings.getState().update({ pets: false, petsPlace: 'nodes', petsSets: ['buddies'], petsVisitor: true, petsSubagents: true, petsInViews: true });
});

describe('pets on a canvas', () => {
    test('stay away until a person turns them on in Settings, Pets, and go again when they turn them off', async () => {
        await open();
        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id) }));
        expect(pet(WRITER.id)).toBeNull();

        await act(async () => useUi.getState().setSettings({ open: true, section: 'pets' }));
        await until(() => petsSwitch() !== null);
        expect(petsSwitch()?.getAttribute('aria-checked')).toBe('false');

        await clickOn(petsSwitch());
        await until(() => pet(WRITER.id) !== null);
        // A note has no agent, so no pet.
        expect(pet(PLAN.id)).toBeNull();

        // Turned off, a pet beams out where it stood before it goes, a picture that takes no press.
        await clickOn(petsSwitch());
        await until(() => pet(WRITER.id) === null);
        expect(canvas.page.host.querySelector(`[data-pet-box="${WRITER.id}"][data-pet-leaving]`)).not.toBeNull();
    });

    test('the visitor is on until a person turns it off in Settings, Pets', async () => {
        await open();
        await act(async () => useUi.getState().setSettings({ open: true, section: 'pets' }));
        const visitorSwitch = (): HTMLElement | null => document.querySelector('[role="switch"][aria-label="Visitor"]');
        await until(() => visitorSwitch() !== null);
        expect(visitorSwitch()?.getAttribute('aria-checked')).toBe('true');

        await clickOn(visitorSwitch());
        await until(() => useSettings.getState().petsVisitor === false);
    });

    test('a person switches on several sets of figures in Settings, Pets, each with a preview, and never none', async () => {
        await open();
        await act(async () => useUi.getState().setSettings({ open: true, section: 'pets' }));
        const setSwitch = (name: string): HTMLElement | null => document.querySelector(`[role="switch"][aria-label="Use ${name}"]`);
        await until(() => setSwitch('Buddies') !== null);
        expect(document.querySelector('[role="img"][aria-label="Preview of Fox and frog"]')).not.toBeNull();
        expect(setSwitch('Buddies')?.getAttribute('aria-checked')).toBe('true');
        expect(setSwitch('Fox and frog')?.getAttribute('aria-checked')).toBe('false');
        // The only set picked cannot be left out.
        expect(setSwitch('Buddies')?.hasAttribute('data-disabled')).toBe(true);

        await clickOn(setSwitch('Fox and frog'));
        await until(() => setSwitch('Fox and frog')?.getAttribute('aria-checked') === 'true');
        expect(useSettings.getState().petsSets).toEqual(['buddies', 'animals']);

        await clickOn(setSwitch('Buddies'));
        await until(() => setSwitch('Buddies')?.getAttribute('aria-checked') === 'false');
        expect(useSettings.getState().petsSets).toEqual(['animals']);
        expect(setSwitch('Fox and frog')?.hasAttribute('data-disabled')).toBe(true);
    });

    test('a chat that waits on you has a pet that says so, until the question is answered', async () => {
        useSettings.getState().update({ pets: true });
        await open();
        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id) }));
        await until(() => pet(WRITER.id) !== null);
        expect(pet(WRITER.id)?.getAttribute('data-pet-mood')).toBe('idle');

        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id, { status: 'needs-you' }) }));
        await until(() => pet(WRITER.id)?.getAttribute('data-pet-mood') === 'waiting');
        expect(pet(WRITER.id)?.getAttribute('aria-label')).toBe('Writer needs you');

        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id) }));
        await until(() => pet(WRITER.id)?.getAttribute('data-pet-mood') === 'idle');
        expect(pet(WRITER.id)?.getAttribute('aria-label')).toBe('Go to Writer');
    });

    test('a pet standing on the node above takes no press, so the bottom of that node stays its own', async () => {
        // happy-dom does no hit testing, so this holds what decides it: the box that takes a press and whether it takes one.
        const upper: ProjectNode = { id: 'upper', kind: 'chat', title: 'Upper', x: 0, y: 0, w: 480, h: 300 };
        const close: ProjectNode = { id: 'close', kind: 'chat', title: 'Close', x: 0, y: 310, w: 480, h: 300 };
        const spaced: ProjectNode = { id: 'spaced', kind: 'chat', title: 'Spaced', x: 600, y: 340, w: 480, h: 300 };
        const above: ProjectNode = { id: 'above', kind: 'chat', title: 'Above', x: 600, y: 0, w: 480, h: 300 };
        useSettings.getState().update({ pets: true });
        canvas = await openCanvasPage(machine, [{ ...MAIN, nodes: [PLAN, upper, close, above, spaced] }], PLAN.id);
        await act(async () => {
            for (const node of [upper, close, above, spaced]) {
                machine.emit('chat.status', { chatId: node.id, info: chatInfoOf(node.id) });
            }
        });
        await until(() => pet(spaced.id) !== null && pet(close.id) !== null);

        expect(pet(close.id)?.hasAttribute('data-pet-blocked')).toBe(true);
        expect(pet(close.id)?.classList.contains('pointer-events-none')).toBe(true);
        // Forty pixels apart, the gap new nodes get, the figure stands clear of the node above and takes its press.
        expect(pet(spaced.id)?.hasAttribute('data-pet-blocked')).toBe(false);
        expect(pet(spaced.id)?.classList.contains('pointer-events-auto')).toBe(true);
        expect(pet(spaced.id)?.style.height).toBe('38px');
    });

    test('a click on a pet brings its node to the middle of the view and selects it', async () => {
        useSettings.getState().update({ pets: true });
        await open();
        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id, { status: 'needs-you' }) }));
        await until(() => pet(WRITER.id) !== null);

        await clickOn(pet(WRITER.id));

        const camera = store().getState().camera;
        expect(store().getState().selection).toEqual([WRITER.id]);
        expect((VIEWPORT.w / 2 - camera.x) / camera.zoom).toBeCloseTo(WRITER.x + WRITER.w / 2);
        expect((VIEWPORT.h / 2 - camera.y) / camera.zoom).toBeCloseTo(WRITER.y + WRITER.h / 2);
    });

    test('along the bottom of the screen, a pet leaves its node and still leads to it', async () => {
        useSettings.getState().update({ pets: true, petsPlace: 'screen' });
        await open();
        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id) }));
        const roaming = (): HTMLElement | null => document.querySelector(`[data-pet-roam] [data-pet="${WRITER.id}"]`);
        await until(() => roaming() !== null);
        expect(document.querySelectorAll(`[data-pet="${WRITER.id}"]`)).toHaveLength(1);
        expect(roaming()?.getAttribute('aria-label')).toBe('Go to Writer');

        await clickOn(roaming());

        expect(store().getState().selection).toEqual([WRITER.id]);
    });

    test('a chat with sub-agents at work takes a smaller pet along for each, until one ends or a person turns them off', async () => {
        const reviewer = subagent('reviewer');
        attachWith([reviewer, subagent('tester')]);
        useSettings.getState().update({ pets: true });
        await open();
        // Kids are drawn only while their node is in view, as their pet is.
        await act(async () => store().getState().setCamera({ x: -1800, y: -800, zoom: 1 }));
        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id) }));
        await until(() => kids(WRITER.id).length === 2);
        expect(kids(PLAN.id)).toEqual([]);

        await act(async () =>
            machine.emit('chat.event', { chatId: WRITER.id, event: { type: 'item', item: { ...reviewer, status: 'done', finishedAt: 2 } }, seq: 2 })
        );
        await until(() => kids(WRITER.id).length === 1);

        await act(async () => useUi.getState().setSettings({ open: true, section: 'pets' }));
        const kidsSwitch = (): HTMLElement | null => document.querySelector('[role="switch"][aria-label="Sub-agents"]');
        await until(() => kidsSwitch() !== null);
        expect(kidsSwitch()?.getAttribute('aria-checked')).toBe('true');
        await clickOn(kidsSwitch());
        await until(() => kids(WRITER.id).length === 0);
        expect(pet(WRITER.id)).not.toBeNull();
    });

    test('along the bottom of the screen, the kids walk there too and take no press', async () => {
        attachWith([subagent('reviewer'), subagent('tester'), subagent('linter'), subagent('docs')]);
        useSettings.getState().update({ pets: true, petsPlace: 'screen' });
        await open();
        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id) }));
        const roaming = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(`[data-pet-roam] [data-pet-kid="${WRITER.id}"]`)];
        // Three at most, however many sub-agents work.
        await until(() => roaming().length === 3);
        expect(roaming().map((kid) => kid.querySelector('button'))).toEqual([null, null, null]);
    });

    test('kids go with their pet when a collapsed group hides its node', async () => {
        const team: ProjectNode = { id: 'team', kind: 'group', title: 'Team', x: 1900, y: 900, w: 700, h: 700 };
        attachWith([subagent('reviewer')]);
        useSettings.getState().update({ pets: true });
        canvas = await openCanvasPage(machine, [{ ...MAIN, nodes: [PLAN, team, WRITER] }], PLAN.id);
        await act(async () => {
            store().getState().setViewport(VIEWPORT);
            store().getState().setCamera({ x: -1800, y: -800, zoom: 1 });
        });
        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id) }));
        await until(() => kids(WRITER.id).length === 1);

        await act(async () => store().getState().toggleCollapse(team.id));
        await until(() => pet(WRITER.id) === null);
        expect(kids(WRITER.id)).toEqual([]);
    });

    test('kids move with their pet between its node and the bottom of the screen', async () => {
        attachWith([subagent('reviewer'), subagent('tester')]);
        useSettings.getState().update({ pets: true });
        await open();
        await act(async () => store().getState().setCamera({ x: -1800, y: -800, zoom: 1 }));
        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id) }));
        const roaming = (): Element[] => [...document.querySelectorAll(`[data-pet-roam] [data-pet-kid="${WRITER.id}"]`)];
        await until(() => kids(WRITER.id).length === 2);
        expect(roaming()).toEqual([]);

        await act(async () => useSettings.getState().update({ petsPlace: 'screen' }));
        await until(() => roaming().length === 2);
        expect(document.querySelectorAll(`[data-pet-kid="${WRITER.id}"]`)).toHaveLength(2);

        await act(async () => useSettings.getState().update({ petsPlace: 'nodes' }));
        await until(() => roaming().length === 0 && kids(WRITER.id).length === 2);
    });
});

describe('a figure per agent', () => {
    afterEach(() => {
        useSettings.getState().update({ petsByAgent: {} });
    });

    test('a person gives each CLI on the machine a figure of its own in Settings, Pets, and Default takes it back', async () => {
        machine.answer('provider.list', () => ({
            providers: [claudeProvider(), fakeProvider('codex', 'Codex')]
        }));
        await open();
        await act(async () => useUi.getState().setSettings({ open: true, section: 'pets' }));
        const trigger = (name: string): HTMLElement | null => document.querySelector(`[aria-label="Figure for ${name}"]`);
        await until(() => trigger('Codex') !== null && trigger('Claude Code') !== null);
        expect(trigger('Codex')?.textContent).toContain('Default');

        await clickOn(trigger('Codex'));
        await until(() => document.querySelector('[role="option"]') !== null);
        await clickOn([...document.querySelectorAll('[role="option"]')].find((option) => option.textContent?.startsWith('Fox and frog')) ?? null);
        await until(() => useSettings.getState().petsByAgent.codex === 'animals');
        expect(useSettings.getState().petsByAgent).toEqual({ codex: 'animals' });

        await clickOn(trigger('Codex'));
        await until(() => document.querySelector('[role="option"]') !== null);
        await clickOn([...document.querySelectorAll('[role="option"]')].find((option) => option.textContent?.startsWith('Default')) ?? null);
        await until(() => useSettings.getState().petsByAgent.codex === undefined);
    });
});

describe('a figure of your own', () => {
    // A PNG header for a strip of four frames of 16 pixels, which is all a stored figure is checked on.
    const head = `\x89PNG\r\n\x1a\n${String.fromCharCode(0, 0, 0, 13)}IHDR${String.fromCharCode(0, 0, 0, 64, 0, 0, 0, 16, 8, 6, 0, 0, 0)}`;
    const STRIP = { image: `data:image/png;base64,${btoa(head.padEnd(64, '\0'))}`, frameSize: 16, frames: 4 };
    const CAT = { id: 'cat', name: 'Cat', ...STRIP, strips: { work: STRIP } };

    function dialog(): HTMLElement | null {
        return document.querySelector('[role="dialog"] [data-pet-state]')?.closest('[role="dialog"]') ?? null;
    }

    async function openSettings(): Promise<void> {
        await open();
        await act(async () => useUi.getState().setSettings({ open: true, section: 'pets' }));
        await until(() => buttonWithText('Add figure') !== null);
    }

    afterEach(async () => {
        await act(async () => {
            for (const sprite of usePetSprites.getState().sprites) {
                usePetSprites.getState().remove(sprite.id);
            }
        });
    });

    test('a new one lists every state a pet has, and needs a name and a strip to stand in before it saves', async () => {
        await openSettings();
        await clickOn(buttonWithText('Add figure'));
        await until(() => dialog() !== null);

        const states = [...dialog()!.querySelectorAll('[data-pet-state]')].map((row) => row.getAttribute('data-pet-state'));
        expect(states).toEqual(['stand', 'walk', 'work', 'wait', 'sleep', 'stopped']);
        expect(dialog()?.textContent).toContain('Every figure needs this one');
        expect(dialog()?.textContent).toContain('Plays Standing, tipped over');

        await typeInto(dialog()!.querySelector('input:not([type="file"])')!, 'Cat');
        expect(buttonWithText('Save', dialog()!)?.disabled).toBe(true);
    });

    test('a new one is kept once it has a name and a strip to stand in, and joins the sets already picked', async () => {
        // happy-dom decodes no image, so the browser's reading is stood in for; the checks on its answer are the real ones.
        const real = { ...browserSheetReader };
        browserSheetReader.dataUrl = async () => STRIP.image;
        browserSheetReader.size = async () => ({ width: 64, height: 16 });
        try {
            await openSettings();
            await clickOn(buttonWithText('Add figure'));
            await until(() => dialog() !== null);

            await clickOn(dialog()!.querySelector('button[aria-label="Choose file for Standing"]'));
            const input = dialog()!.querySelector<HTMLInputElement>('input[type="file"]')!;
            Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'cat.png', { type: 'image/png' })] });
            await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
            await until(() => dialog()?.querySelector('[data-pet-state="stand"]')?.textContent?.includes('4 frames, 16 px') === true);
            expect(dialog()?.querySelector('button[aria-label="Replace the strip for Standing"]')).not.toBeNull();

            await typeInto(dialog()!.querySelector('input:not([type="file"])')!, 'Cat');
            await clickOn(buttonWithText('Save', dialog()!));

            await until(() => usePetSprites.getState().sprites.length === 1);
            const [cat] = usePetSprites.getState().sprites;
            expect(cat).toMatchObject({ name: 'Cat', ...STRIP });
            expect(useSettings.getState().petsSets).toEqual(['buddies', `custom:${cat.id}`]);
        } finally {
            Object.assign(browserSheetReader, real);
        }
    });

    test('a file that is no PNG or WebP is refused on its row, tied to its button, and nothing is kept', async () => {
        await openSettings();
        await clickOn(buttonWithText('Add figure'));
        await until(() => dialog() !== null);

        await clickOn(dialog()!.querySelector('button[aria-label="Choose file for Working"]'));
        const input = dialog()!.querySelector<HTMLInputElement>('input[type="file"]')!;
        Object.defineProperty(input, 'files', { configurable: true, value: [new File(['<svg onload="x()"></svg>'], 'cat.svg', { type: 'image/svg+xml' })] });
        await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));

        await until(() => dialog()?.querySelector('[data-pet-state="work"]')?.textContent?.includes('Pick a PNG or WebP image.') === true);
        const button = dialog()!.querySelector('button[aria-label="Choose file for Working"]')!;
        expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe('Pick a PNG or WebP image.');
        expect(usePetSprites.getState().sprites).toEqual([]);
    });

    test('one added before opens with its strips, and a strip left out and a new name are kept on Save', async () => {
        localStorage.setItem('ruimte.pets.sprites', JSON.stringify([CAT]));
        usePetSprites.getState().reload();
        await openSettings();
        expect(everything()).toContain('2 states');

        await clickOn(document.querySelector('button[aria-label="Edit Cat"]'));
        await until(() => dialog() !== null);
        expect(dialog()?.querySelector('[data-pet-state="work"]')?.textContent).toContain('4 frames, 16 px');
        expect(dialog()?.querySelector('[data-pet-state="sleep"]')?.textContent).toContain('Plays Standing');

        await clickOn(dialog()!.querySelector('button[aria-label="Remove the strip for Working"]'));
        // The keys stay on the row, on the button that gives it a strip again.
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Choose file for Working');
        await typeInto(dialog()!.querySelector('input:not([type="file"])')!, 'Kitten');
        await clickOn(buttonWithText('Save', dialog()!));

        await until(() => usePetSprites.getState().sprites[0]?.name === 'Kitten');
        expect(usePetSprites.getState().sprites).toEqual([{ id: 'cat', name: 'Kitten', ...STRIP }]);
        // A figure changed keeps its place among the sets; it was not picked, so it stays unpicked.
        expect(useSettings.getState().petsSets).toEqual(['buddies']);
    });
});
