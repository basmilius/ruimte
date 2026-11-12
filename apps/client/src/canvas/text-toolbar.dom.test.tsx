import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView } from '@ruimte/contracts';
import { act } from 'react';
import { liveCanvas } from '@/state/canvas';
import { windowWorkspace } from '@/workspace/window';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';
import { clickOn, until } from '../../testing/dom';
import { menuItem } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';

const MAIN: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [],
    texts: [{ id: 'title', x: 40, y: 40, text: 'Roadmap', size: 16 }],
    edges: [],
    layouts: []
};

let machine: FakeMachine;
let canvas: CanvasPage;

function text(): HTMLElement | null {
    return canvas.page.host.querySelector<HTMLElement>('[data-text-id="title"]');
}

function sizeButton(): HTMLElement | null {
    return canvas.page.host.querySelector<HTMLElement>('[role="toolbar"][aria-label="Text formatting"] button[aria-label="Size"]');
}

function sizeRows(): string[] {
    return [...document.querySelectorAll('[role="menuitemradio"]')].map((row) => row.textContent?.trim() ?? '');
}

beforeEach(async () => {
    machine = new FakeMachine();
    canvas = await openCanvasPage(machine, [MAIN], (host) => host.querySelector('[data-text-id="title"]') !== null);
    await act(async () => liveCanvas('main')!.select(['title']));
    await until(() => sizeButton() !== null);
});

afterEach(async () => {
    await canvas.close();
});

describe('the size of a canvas text', () => {
    test('offers the steps up to 96 px, the three largest included', async () => {
        await clickOn(sizeButton());
        await until(() => sizeRows().length > 0);

        expect(sizeRows()).toEqual(['16 px', '20 px', '28 px', '36 px', '48 px', '64 px', '96 px']);
    });

    test.each([48, 64, 96])('draws the text at %p px once picked, and saves that size', async (size) => {
        await clickOn(sizeButton());
        await until(() => sizeRows().length > 0);
        await clickOn(menuItem(`${size} px`, 'menuitemradio'));
        await until(() => text()?.style.fontSize === `${size}px`);

        expect(sizeButton()?.textContent).toContain(String(size));

        await act(async () => windowWorkspace()!.connection.projects.flush());
        const saved = machine
            .requests('project.save')
            .at(-1)
            ?.content.views.find((view) => view.id === 'main');

        expect(saved?.kind === 'canvas' ? saved.texts?.[0]?.size : null).toBe(size);
    });
});
